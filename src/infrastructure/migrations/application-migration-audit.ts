import { createHash } from 'crypto'
import { QueryRunner, Table } from 'typeorm'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import {
  createAppErrorLogTable,
  createErrorTable,
  createSuccessTable,
  createVersionTable,
  calculateNextReleaseSequence
} from '@/utils/version'
import {
  inspectBackfillRow,
  legacyFingerprintFields,
  migratedTableKinds,
  MigratedTableKind,
  StoredRow
} from '@/infrastructure/persistence/legacy/backfill-row'
import {
  APPLICATION_MIGRATION_LEDGER,
  ApplicationMigrationPlan,
  MigrationOptions,
  TableAudit
} from './application-migration-contract'

export function migrationSchemas(
  tablePrefix: string
): Record<MigratedTableKind, Table> {
  const source = { tablePrefix }
  return {
    version: createVersionTable(source),
    success: createSuccessTable(source),
    error: createErrorTable(source),
    errorLog: createAppErrorLogTable(source)
  }
}

export function quotedTable(name: string) {
  if (!/^[A-Za-z0-9_]{1,64}$/.test(name))
    throw new Error('Unsafe physical table name')
  return `\`${name}\``
}

export async function rows(
  runner: QueryRunner,
  sql: string,
  parameters: unknown[] = []
): Promise<StoredRow[]> {
  return (await runner.query(sql, parameters)) as StoredRow[]
}

export async function auditApplication(
  runner: QueryRunner,
  options: MigrationOptions,
  fingerprintColumns?: Partial<Record<MigratedTableKind, string[]>>
): Promise<ApplicationMigrationPlan> {
  new ApplicationTableResolver().resolve(options.appName, options.tablePrefix)
  const schemas = migrationSchemas(options.tablePrefix)
  const errors: string[] = []
  let registered = false
  let readModel = 'compatible'
  if (await runner.hasTable('ota_applications')) {
    const records = await rows(
      runner,
      'SELECT app_name, table_prefix, status, schema_version FROM ota_applications WHERE app_name = ? OR table_prefix = ?',
      [options.appName, options.tablePrefix]
    )
    registered = records.some(
      row =>
        row.app_name === options.appName &&
        row.table_prefix === options.tablePrefix
    )
    if (registered && records.some(row => Number(row.schema_version) < 1))
      errors.push('Application schema must be prepared before data migration')
    if (
      records.some(
        row =>
          row.app_name !== options.appName ||
          row.table_prefix !== options.tablePrefix
      )
    )
      errors.push(
        'Application or prefix is already registered with a different mapping'
      )
    if (
      registered &&
      (await runner.hasColumn('ota_applications', 'read_model'))
    ) {
      const state = await rows(
        runner,
        'SELECT read_model FROM ota_applications WHERE app_name = ?',
        [options.appName]
      )
      const model = state[0]?.read_model ?? 'compatible'
      if (model !== 'compatible' && model !== 'formal')
        errors.push('Application read model is invalid')
      else readModel = model
    }
  }
  if (!registered)
    errors.push(
      'Register and prepare the confirmed application mapping before applying data migration'
    )
  const ledgerAvailable =
    (await runner.hasTable(APPLICATION_MIGRATION_LEDGER)) &&
    (await runner.hasColumn('ota_applications', 'read_model'))
  const tables: TableAudit[] = []
  for (const kind of migratedTableKinds) {
    const desired = schemas[kind]
    const table = await runner.getTable(desired.name)
    const originalColumns = new Set(
      table?.columns.map(column => column.name) ?? []
    )
    const selectedColumns =
      fingerprintColumns?.[kind] ??
      legacyFingerprintFields[kind].filter(name => originalColumns.has(name))
    const audit: TableAudit = {
      kind,
      tableName: desired.name,
      exists: Boolean(table),
      missingColumns: desired.columns
        .filter(column => !originalColumns.has(column.name))
        .map(column => column.name),
      fingerprintColumns: [...selectedColumns],
      rowCount: 0,
      maximumId: 0,
      autoIncrement: 0,
      idFingerprint: '',
      legacyFingerprint: '',
      reportCount: '0',
      pendingRows: 0,
      issueCount: 0,
      issues: []
    }
    const idHash = createHash('sha256')
    const legacyHash = createHash('sha256')
    if (!table) {
      if (kind === 'version')
        errors.push(
          'Confirmed historical version table does not exist; refusing to create a replacement'
        )
    } else {
      const metadata = await rows(
        runner,
        'SELECT ENGINE AS engine, AUTO_INCREMENT AS nextId FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        [desired.name]
      )
      if (String(metadata[0]?.engine).toLowerCase() !== 'innodb')
        errors.push(`${kind}: InnoDB is required for transactional checkpoints`)
      audit.autoIncrement = Number(metadata[0]?.nextId ?? 0)
      const required = [
        'id',
        'name',
        ...(kind === 'version'
          ? ['ver', 'platform']
          : kind === 'errorLog'
            ? ['ver', 'platform', 'kind']
            : ['ver_id'])
      ]
      if (required.some(name => !originalColumns.has(name))) {
        errors.push(`${kind}: required historical columns are missing`)
      } else {
        const summary = await rows(
          runner,
          `SELECT COUNT(*) AS total, MIN(id) AS minimumId, MAX(id) AS maximumId FROM ${quotedTable(desired.name)}`
        )
        audit.maximumId = Number(summary[0]?.maximumId ?? 0)
        if (
          Number(summary[0]?.total) &&
          (Number(summary[0]?.minimumId) < 1 ||
            !Number.isSafeInteger(audit.maximumId))
        )
          errors.push(`${kind}: invalid historical ID range`)
        let afterId = 0
        let aggregateCount = 0n
        while (true) {
          const batch = await rows(
            runner,
            `SELECT * FROM ${quotedTable(desired.name)} WHERE id > ? ORDER BY id ASC LIMIT ?`,
            [afterId, options.batchSize]
          )
          if (!batch.length) break
          for (const row of batch) {
            const result = inspectBackfillRow(kind, row)
            if (row.name !== options.appName)
              result.issues.push({
                id: Number(row.id),
                field: 'name',
                reason:
                  'Physical table contains another or missing application name'
              })
            audit.rowCount++
            if (Object.keys(result.patch).length) audit.pendingRows++
            audit.issueCount += result.issues.length
            audit.issues.push(
              ...result.issues.slice(0, Math.max(0, 50 - audit.issues.length))
            )
            idHash.update(`${String(row.id)}\n`)
            legacyHash.update(
              JSON.stringify(selectedColumns.map(key => row[key] ?? null)) +
                '\n'
            )
            if (kind === 'errorLog') {
              try {
                aggregateCount += BigInt(
                  (row.report_count ?? 1) as string | number | bigint
                )
              } catch {
                /* reported as a row issue */
              }
            }
          }
          const nextId = Number(batch[batch.length - 1].id)
          if (!Number.isSafeInteger(nextId) || nextId <= afterId)
            throw new Error('Invalid migration pagination key')
          afterId = nextId
        }
        audit.reportCount = String(
          kind === 'errorLog' ? aggregateCount : BigInt(audit.rowCount)
        )
        if (audit.rowCount !== Number(summary[0]?.total))
          errors.push(`${kind}: row count changed or invalid IDs were skipped`)
      }
      for (const column of kind === 'version'
        ? ['release_id']
        : kind === 'errorLog'
          ? []
          : ['report_id']) {
        if (originalColumns.has(column)) {
          const duplicates = await rows(
            runner,
            `SELECT COUNT(*) AS total FROM (SELECT \`${column}\` FROM ${quotedTable(desired.name)} WHERE \`${column}\` IS NOT NULL ${column === 'release_id' ? `AND \`${column}\` <> ''` : ''} GROUP BY \`${column}\` HAVING COUNT(*) > 1) duplicates`
          )
          if (Number(duplicates[0]?.total))
            errors.push(
              `${kind}: duplicate ${column} values require manual reconciliation`
            )
        }
      }
    }
    audit.idFingerprint = idHash.digest('hex')
    audit.legacyFingerprint = legacyHash.digest('hex')
    tables.push(audit)
  }
  const version = tables[0]
  return {
    appName: options.appName,
    tablePrefix: options.tablePrefix,
    registered,
    ledgerAvailable,
    readModel,
    errors,
    tables,
    nextReleaseSequence: calculateNextReleaseSequence(
      version.autoIncrement,
      version.maximumId,
      options.confirmedIssuedId
    )
  }
}
