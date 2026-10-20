import { DataSource, QueryRunner, TableIndex } from 'typeorm'
import {
  inspectBackfillRow,
  migratedTableKinds
} from '@/compat/legacy/persistence/backfill-row'
import {
  auditApplication,
  migrationSchemas,
  quotedTable,
  rows
} from './application-migration-audit'
import {
  APPLICATION_DATA_MIGRATION,
  APPLICATION_MIGRATION_LEDGER,
  applicationPreparationLock,
  ApplicationMigrationPlan,
  MigrationOptions,
  MigrationProgress,
  sameHistoricalData
} from './application-migration-contract'

export class MigrationBlockedError extends Error {
  constructor(
    message: string,
    readonly plan?: ApplicationMigrationPlan
  ) {
    super(message)
  }
}

export function validateMigrationOptions(options: MigrationOptions) {
  if (
    !Number.isSafeInteger(options.batchSize) ||
    options.batchSize < 1 ||
    options.batchSize > 1000
  )
    throw new Error('batch-size must be 1–1000')
  if (
    options.maximumBatches !== undefined &&
    (!Number.isSafeInteger(options.maximumBatches) ||
      options.maximumBatches < 1)
  )
    throw new Error('max-batches must be positive')
  if (
    options.confirmedIssuedId !== undefined &&
    (!Number.isSafeInteger(options.confirmedIssuedId) ||
      options.confirmedIssuedId < 0 ||
      options.confirmedIssuedId >= 2147483647)
  )
    throw new Error('issued-id must be 0–2147483646')
  if (
    options.mode === 'apply' &&
    (!options.confirmBackup ||
      !options.confirmWritesPaused ||
      options.confirmedIssuedId === undefined)
  ) {
    throw new Error(
      'apply requires explicit backup, paused-writes and historical issued-ID confirmations'
    )
  }
  if (options.activateFormal && options.mode !== 'apply')
    throw new Error('activate-formal requires apply')
}

export class ApplicationDataMigrator {
  constructor(private readonly source: DataSource) {}

  async run(options: MigrationOptions) {
    validateMigrationOptions(options)
    const runner = this.source.createQueryRunner()
    await runner.connect()
    let locked = false
    let started = false
    try {
      if (options.mode !== 'apply') {
        const plan = await this.snapshot(runner, options)
        const complete =
          !plan.errors.length &&
          !plan.tables.some(
            table =>
              table.issueCount ||
              table.pendingRows ||
              table.missingColumns.length
          )
        return {
          mode: options.mode,
          status:
            plan.errors.length || plan.tables.some(table => table.issueCount)
              ? 'blocked'
              : options.mode === 'verify'
                ? complete
                  ? 'verified'
                  : 'incomplete'
                : 'planned',
          plan
        }
      }

      const lock = await rows(runner, 'SELECT GET_LOCK(?, 0) AS acquired', [
        applicationPreparationLock(options.appName)
      ])
      locked = Number(lock[0]?.acquired) === 1
      if (!locked)
        throw new MigrationBlockedError(
          'Application preparation or migration is already running'
        )
      const plan = await this.snapshot(runner, options)
      if (
        plan.errors.length ||
        plan.tables.some(table => table.issueCount) ||
        !plan.ledgerAvailable
      ) {
        throw new MigrationBlockedError(
          'Preflight failed; inspect the report and complete global migrations/preparation first',
          plan
        )
      }
      const saved = (
        await rows(
          runner,
          `SELECT * FROM ${APPLICATION_MIGRATION_LEDGER} WHERE app_name = ? AND migration_key = ?`,
          [options.appName, APPLICATION_DATA_MIGRATION]
        )
      )[0]
      if (saved && saved.table_prefix !== options.tablePrefix)
        throw new MigrationBlockedError(
          'Checkpoint belongs to a different physical prefix'
        )
      // Completed runs are re-audited from scratch, including newly dual-written rows.
      const resumable = saved && saved.status !== 'completed'
      let progress = resumable
        ? this.parseProgress(saved.progress)
        : (Object.fromEntries(
            plan.tables.map(table => [
              table.kind,
              {
                afterId: 0,
                scanned: 0,
                updated: 0,
                complete: false,
                baseline: table
              }
            ])
          ) as MigrationProgress)
      const issuedId = Math.max(
        options.confirmedIssuedId!,
        Number(saved?.confirmed_issued_id ?? 0)
      )
      if (resumable) {
        for (const kind of migratedTableKinds) {
          if (
            progress[kind].baseline.tableName !==
            migrationSchemas(options.tablePrefix)[kind].name
          )
            throw new MigrationBlockedError(
              'Checkpoint table does not match the confirmed mapping'
            )
        }
        const current = await this.snapshot(runner, options, progress)
        for (const table of current.tables) {
          if (!sameHistoricalData(progress[table.kind].baseline, table)) {
            throw new MigrationBlockedError(
              'Historical data changed since checkpoint; do not reset progress without reconciliation',
              current
            )
          }
        }
      }
      await runner.startTransaction()
      try {
        await runner.query(
          `INSERT INTO ${APPLICATION_MIGRATION_LEDGER}
           (app_name, migration_key, table_prefix, status, progress, confirmed_issued_id, created_at, updated_at)
           VALUES (?, ?, ?, 'running', ?, ?, NOW(), NOW())
           ON DUPLICATE KEY UPDATE status = 'running', progress = VALUES(progress),
             confirmed_issued_id = VALUES(confirmed_issued_id), error_code = NULL, completed_at = NULL, updated_at = NOW()`,
          [
            options.appName,
            APPLICATION_DATA_MIGRATION,
            options.tablePrefix,
            JSON.stringify(progress),
            issuedId
          ]
        )
        await runner.query(
          "UPDATE ota_applications SET status = 'preparing', updated_at = NOW() WHERE app_name = ? AND table_prefix = ?",
          [options.appName, options.tablePrefix]
        )
        await runner.commitTransaction()
        started = true
      } catch (error) {
        await runner.rollbackTransaction()
        throw error
      }
      // MySQL DDL commits separately. Resume discovers already-added columns.
      await this.ensureColumns(runner, options.tablePrefix)
      let batches = 0
      for (const kind of migratedTableKinds) {
        while (!progress[kind].complete) {
          if (
            options.maximumBatches !== undefined &&
            batches >= options.maximumBatches
          ) {
            await this.saveStatus(runner, options, 'paused')
            return { mode: options.mode, status: 'paused', progress }
          }
          const next = this.parseProgress(JSON.stringify(progress))
          const step = next[kind]
          await runner.startTransaction()
          try {
            const batch = await rows(
              runner,
              `SELECT * FROM ${quotedTable(step.baseline.tableName)} WHERE id > ? AND id <= ? ORDER BY id ASC LIMIT ? FOR UPDATE`,
              [step.afterId, step.baseline.maximumId, options.batchSize]
            )
            for (const row of batch) {
              const { patch, issues } = inspectBackfillRow(kind, row)
              if (row.name !== options.appName || issues.length)
                throw new MigrationBlockedError(
                  `${kind}: row ${String(row.id)} failed locked-row validation`
                )
              if (Object.keys(patch).length) {
                await runner.manager
                  .createQueryBuilder()
                  .update(step.baseline.tableName)
                  .set(patch)
                  .where('id = :id AND name = :appName', {
                    id: row.id,
                    appName: options.appName
                  })
                  .execute()
                step.updated++
              }
              step.scanned++
              step.afterId = Number(row.id)
            }
            step.complete =
              batch.length === 0 || step.afterId >= step.baseline.maximumId
            await runner.query(
              `UPDATE ${APPLICATION_MIGRATION_LEDGER} SET progress = ?, updated_at = NOW() WHERE app_name = ? AND migration_key = ?`,
              [
                JSON.stringify(next),
                options.appName,
                APPLICATION_DATA_MIGRATION
              ]
            )
            await runner.commitTransaction()
            progress = next
            if (batch.length) batches++
          } catch (error) {
            await runner.rollbackTransaction()
            throw error
          }
        }
      }
      await this.ensureUniqueIndexes(runner, options.tablePrefix)
      const final = await this.snapshot(
        runner,
        { ...options, confirmedIssuedId: issuedId },
        progress
      )
      for (const table of final.tables) {
        if (
          !sameHistoricalData(progress[table.kind].baseline, table) ||
          table.issueCount ||
          table.pendingRows ||
          table.missingColumns.length
        ) {
          throw new MigrationBlockedError(
            'Post-migration reconciliation failed; read model was not switched',
            final
          )
        }
      }
      if (final.errors.length)
        throw new MigrationBlockedError(
          'Post-migration application validation failed',
          final
        )
      // Never lower the current auto-increment or confirmed already-issued watermark.
      await runner.query(
        `ALTER TABLE ${quotedTable(final.tables[0].tableName)} AUTO_INCREMENT = ${final.nextReleaseSequence}`
      )
      await runner.startTransaction()
      try {
        await runner.query(
          `UPDATE ota_applications SET status = 'ready', schema_version = GREATEST(schema_version, 2),
             catalog_revision = catalog_revision + 1, updated_at = NOW()
             ${options.activateFormal ? ", read_model = 'formal'" : ''}
           WHERE app_name = ? AND table_prefix = ?`,
          [options.appName, options.tablePrefix]
        )
        await this.saveStatus(runner, options, 'completed')
        await runner.commitTransaction()
      } catch (error) {
        await runner.rollbackTransaction()
        throw error
      }
      final.readModel = options.activateFormal ? 'formal' : final.readModel
      return { mode: options.mode, status: 'completed', plan: final, progress }
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      if (started) {
        await runner.startTransaction()
        try {
          await this.saveStatus(runner, options, 'failed')
          await runner.query(
            "UPDATE ota_applications SET status = 'failed', updated_at = NOW() WHERE app_name = ? AND table_prefix = ?",
            [options.appName, options.tablePrefix]
          )
          await runner.commitTransaction()
        } catch {
          if (runner.isTransactionActive) await runner.rollbackTransaction()
          // The last committed batch checkpoint still remains authoritative.
        }
      }
      throw error
    } finally {
      try {
        if (locked)
          await runner.query('SELECT RELEASE_LOCK(?)', [
            applicationPreparationLock(options.appName)
          ])
      } finally {
        await runner.release()
      }
    }
  }

  private parseProgress(value: unknown): MigrationProgress {
    const parsed = (
      typeof value === 'string' ? JSON.parse(value) : value
    ) as MigrationProgress
    for (const kind of migratedTableKinds) {
      if (
        !parsed?.[kind]?.baseline ||
        !Number.isSafeInteger(parsed[kind].afterId) ||
        parsed[kind].afterId < 0
      ) {
        throw new MigrationBlockedError(
          'Invalid migration checkpoint; manual inspection required'
        )
      }
    }
    return parsed
  }

  private async snapshot(
    runner: QueryRunner,
    options: MigrationOptions,
    progress?: MigrationProgress
  ) {
    await runner.startTransaction('REPEATABLE READ')
    try {
      const columns = progress
        ? Object.fromEntries(
            migratedTableKinds.map(kind => [
              kind,
              progress[kind].baseline.fingerprintColumns
            ])
          )
        : undefined
      const result = await auditApplication(runner, options, columns)
      await runner.commitTransaction()
      return result
    } catch (error) {
      await runner.rollbackTransaction()
      throw error
    }
  }

  private async ensureColumns(runner: QueryRunner, prefix: string) {
    for (const desired of Object.values(migrationSchemas(prefix))) {
      const current = await runner.getTable(desired.name)
      if (!current) await runner.createTable(desired, true)
      else {
        const missing = desired.columns
          .filter(column => !current.findColumnByName(column.name))
          .map(column => {
            const added = column.clone()
            added.isUnique = false // Add unique constraints after backfill and duplicate checks.
            if (!added.isNullable && added.default === undefined)
              added.isNullable = true
            return added
          })
        if (missing.length) await runner.addColumns(desired.name, missing)
      }
    }
  }

  private async ensureUniqueIndexes(runner: QueryRunner, prefix: string) {
    for (const [kind, column] of [
      ['version', 'release_id'],
      ['success', 'report_id'],
      ['error', 'report_id']
    ] as const) {
      const name = migrationSchemas(prefix)[kind].name
      const table = await runner.getTable(name)
      const exists =
        table?.indices.some(
          index =>
            index.isUnique &&
            index.columnNames.length === 1 &&
            index.columnNames[0] === column
        ) ||
        table?.uniques.some(
          index =>
            index.columnNames.length === 1 && index.columnNames[0] === column
        ) ||
        table?.findColumnByName(column)?.isUnique
      if (!exists)
        await runner.createIndex(
          name,
          new TableIndex({
            name: `${name}_${column}_uq`,
            columnNames: [column],
            isUnique: true
          })
        )
    }
  }

  private async saveStatus(
    runner: QueryRunner,
    options: MigrationOptions,
    status: string
  ) {
    await runner.query(
      `UPDATE ${APPLICATION_MIGRATION_LEDGER} SET status = ?, error_code = ?,
         completed_at = ${status === 'completed' ? 'NOW()' : 'NULL'}, updated_at = NOW()
       WHERE app_name = ? AND migration_key = ?`,
      [
        status,
        status === 'failed' ? 'MIGRATION_FAILED' : null,
        options.appName,
        APPLICATION_DATA_MIGRATION
      ]
    )
  }
}
