import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationTables,
  ApplicationTableResolver
} from '@/infrastructure/persistence/application-table-resolver'
import {
  calculateNextReleaseSequence,
  createAppErrorLogTable,
  createErrorTable,
  createSuccessTable,
  createVersionTable
} from '@/utils/version'
import { randomUUID } from 'crypto'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'
import {
  APPLICATION_MIGRATION_LEDGER,
  applicationPreparationLock
} from '@/infrastructure/migrations/application-migration-contract'

export type RegisteredApplication = {
  appName: string
  tablePrefix: string
  schemaVersion: number
  status: 'preparing' | 'ready' | 'failed'
  tables: ApplicationTables
  readModel?: 'compatible' | 'formal'
}

@Injectable()
export class ApplicationRegistryService {
  private readonly logger = new Logger(ApplicationRegistryService.name)

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tableResolver: ApplicationTableResolver
  ) {}

  async resolve(appName: string): Promise<RegisteredApplication> {
    this.tableResolver.validateAppName(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      return await this.resolveSnapshot(appName, queryRunner)
    } finally {
      await queryRunner.release()
    }
  }

  /** Uses the caller's connection so catalog metadata shares its read snapshot. */
  async resolveSnapshot(
    appName: string,
    queryRunner: QueryRunner
  ): Promise<RegisteredApplication & { catalogRevision: number }> {
    this.tableResolver.validateAppName(appName)
    const row = (await queryRunner.hasTable('ota_applications'))
      ? await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from('ota_applications', 'application')
          .where('application.app_name = :appName', { appName })
          .getRawOne<Record<string, unknown>>()
      : undefined
    const tablePrefix = row
      ? String(row.table_prefix)
      : this.tableResolver.legacyPrefix(appName)
    const catalogRevision = row ? Number(row.catalog_revision) : 0
    if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 0) {
      throw new ConflictException('Application catalog revision is invalid')
    }
    const readModel = row?.read_model ?? 'compatible'
    if (readModel !== 'compatible' && readModel !== 'formal')
      throw new ConflictException('Unknown application read model')
    return {
      appName,
      tablePrefix,
      schemaVersion: row ? Number(row.schema_version) : 0,
      status: row
        ? (String(row.status) as RegisteredApplication['status'])
        : 'preparing',
      tables: this.tableResolver.resolve(appName, tablePrefix),
      catalogRevision,
      readModel
    }
  }

  async prepare(
    appName: string,
    context?: GlobalAuditContext
  ): Promise<RegisteredApplication> {
    this.tableResolver.validateAppName(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    const auditContext = context ?? { requestId: randomUUID() }
    const operationId = randomUUID()
    let tablePrefix: string | undefined
    let shouldAudit = false
    const prepareLockName = applicationPreparationLock(appName)
    let prepareLockAcquired = false
    let shouldMarkFailure = false
    await queryRunner.connect()
    try {
      const lockRows = (await queryRunner.query(
        'SELECT GET_LOCK(?, 30) AS acquired',
        [prepareLockName]
      )) as Array<{ acquired: number | string }>
      prepareLockAcquired = Number(lockRows[0]?.acquired) === 1
      if (!prepareLockAcquired) {
        throw new ConflictException('Application preparation is busy')
      }
      if (await queryRunner.hasTable(APPLICATION_MIGRATION_LEDGER)) {
        const pending = (await queryRunner.query(
          `SELECT migration_key FROM ${APPLICATION_MIGRATION_LEDGER} WHERE app_name = ? AND status <> 'completed' LIMIT 1`,
          [appName]
        )) as unknown[]
        if (pending.length)
          throw new ConflictException(
            'Application data migration is unfinished; resume the migration tool first'
          )
      }
      shouldMarkFailure = true
      if (
        !(await queryRunner.hasTable('ota_applications')) ||
        !(await queryRunner.hasTable('ota_admin_audit_log'))
      )
        await this.ensureGlobalTables(queryRunner)
      await queryRunner.startTransaction()
      try {
        const existing = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from('ota_applications', 'application')
          .setLock('pessimistic_write')
          .where('application.app_name = :appName', { appName })
          .getRawOne<Record<string, unknown>>()
        if (
          existing?.status === 'ready' &&
          Number(existing.schema_version) >= 1
        ) {
          await queryRunner.commitTransaction()
          return {
            appName,
            tablePrefix: String(existing.table_prefix),
            schemaVersion: Number(existing.schema_version),
            status: 'ready',
            tables: this.tableResolver.resolve(
              appName,
              String(existing.table_prefix)
            )
          }
        }
        tablePrefix = existing
          ? String(existing.table_prefix)
          : await this.allocatePrefix(queryRunner, appName)
        shouldAudit =
          !existing ||
          String(existing.status) !== 'ready' ||
          Number(existing.schema_version) < 1
        if (!existing) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into('ota_applications')
            .values({
              app_name: appName,
              table_prefix: tablePrefix,
              schema_version: 0,
              status: 'preparing',
              catalog_revision: 0,
              created_at: new Date(),
              updated_at: new Date()
            })
            .execute()
        }
        await queryRunner.commitTransaction()
      } catch (error) {
        await queryRunner.rollbackTransaction()
        throw error
      }

      if (!tablePrefix) {
        throw new Error('Application table prefix was not allocated')
      }
      const tables = this.tableResolver.resolve(appName, tablePrefix)
      await this.ensureVersionTable(queryRunner, tables)
      await this.ensureApplicationTables(queryRunner, tables)
      await queryRunner.startTransaction()
      try {
        await queryRunner.manager
          .createQueryBuilder()
          .update('ota_applications')
          .set({ schema_version: 1, status: 'ready', updated_at: new Date() })
          .where('app_name = :appName', { appName })
          .execute()
        if (shouldAudit) {
          await insertGlobalAudit(queryRunner, {
            context: auditContext,
            operationId,
            action: 'application_prepared',
            targetType: 'application',
            targetId: appName,
            changeSummary: { tablePrefix, schemaVersion: 1 },
            result: 'succeeded'
          })
        }
        await queryRunner.commitTransaction()
      } catch (error) {
        await queryRunner.rollbackTransaction()
        throw error
      }

      return {
        appName,
        tablePrefix,
        schemaVersion: 1,
        status: 'ready',
        tables
      }
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      if (
        shouldMarkFailure &&
        (await queryRunner.hasTable('ota_applications'))
      ) {
        await queryRunner.manager
          .createQueryBuilder()
          .update('ota_applications')
          .set({ status: 'failed', updated_at: new Date() })
          .where('app_name = :appName', { appName })
          .execute()
      }
      if (
        shouldMarkFailure &&
        (await queryRunner.hasTable('ota_admin_audit_log'))
      ) {
        try {
          await insertGlobalAudit(queryRunner, {
            context: auditContext,
            operationId,
            action: 'application_prepared',
            targetType: 'application',
            targetId: appName,
            changeSummary: tablePrefix ? { tablePrefix } : undefined,
            result: 'failed',
            errorCode: 'APPLICATION_PREPARE_FAILED'
          })
        } catch (auditError) {
          this.logger.error(
            `Failed to persist application preparation audit requestId=${auditContext.requestId}`,
            auditError instanceof Error ? auditError.stack : undefined
          )
        }
      }
      throw error
    } finally {
      try {
        if (prepareLockAcquired) {
          await queryRunner.query('SELECT RELEASE_LOCK(?)', [prepareLockName])
        }
      } finally {
        await queryRunner.release()
      }
    }
  }

  async listReady(): Promise<RegisteredApplication[]> {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable('ota_applications'))) {
        return []
      }
      const rows = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from('ota_applications', 'application')
        .where('application.status = :status', { status: 'ready' })
        .orderBy('application.app_name', 'ASC')
        .getRawMany<Record<string, unknown>>()
      return rows.map(row => {
        const appName = String(row.app_name)
        const tablePrefix = String(row.table_prefix)
        return {
          appName,
          tablePrefix,
          schemaVersion: Number(row.schema_version),
          status: 'ready' as const,
          tables: this.tableResolver.resolve(appName, tablePrefix)
        }
      })
    } finally {
      await queryRunner.release()
    }
  }

  async incrementCatalogRevision(
    queryRunner: QueryRunner,
    appName: string,
    updatedAt = new Date()
  ) {
    const result = await queryRunner.manager
      .createQueryBuilder()
      .update('ota_applications')
      .set({
        catalog_revision: () => 'catalog_revision + 1',
        updated_at: updatedAt
      })
      .where('app_name = :appName', { appName })
      .execute()
    if (!result.affected) {
      throw new Error(`Application is not registered: ${appName}`)
    }
    const application = await queryRunner.manager
      .createQueryBuilder()
      .select('application.catalog_revision', 'catalogRevision')
      .from('ota_applications', 'application')
      .where('application.app_name = :appName', { appName })
      .getRawOne<{ catalogRevision: number | string }>()
    const revision = Number(application?.catalogRevision)
    if (!Number.isSafeInteger(revision) || revision < 1) {
      throw new Error(`Application catalog revision is invalid: ${appName}`)
    }
    return revision
  }

  private async allocatePrefix(queryRunner: QueryRunner, appName: string) {
    const initialPrefix = this.tableResolver.collisionSafePrefix(appName)
    const prefixOwner = await this.findByPrefix(queryRunner, initialPrefix)
    if (!prefixOwner || prefixOwner === appName) {
      return initialPrefix
    }

    const safePrefix = this.tableResolver.hashedPrefix(appName)
    const safePrefixOwner = await this.findByPrefix(queryRunner, safePrefix)
    if (safePrefixOwner && safePrefixOwner !== appName) {
      throw new ConflictException('Application table prefix collision')
    }
    return safePrefix
  }

  private async findByPrefix(queryRunner: QueryRunner, tablePrefix: string) {
    const row = await queryRunner.manager
      .createQueryBuilder()
      .select('application.app_name', 'appName')
      .from('ota_applications', 'application')
      .where('application.table_prefix = :tablePrefix', { tablePrefix })
      .getRawOne<{ appName: string }>()
    return row?.appName
  }

  private async ensureGlobalTables(queryRunner: QueryRunner) {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ota_applications (
        app_name VARCHAR(128) NOT NULL,
        table_prefix VARCHAR(40) NOT NULL,
        schema_version INT NOT NULL DEFAULT 0,
        status VARCHAR(16) NOT NULL,
        catalog_revision BIGINT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (app_name),
        UNIQUE KEY ota_applications_table_prefix_uq (table_prefix)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS ota_admin_audit_log (
        audit_id VARCHAR(36) NOT NULL,
        operation_id VARCHAR(36) NOT NULL,
        part_no INT NOT NULL DEFAULT 1,
        actor_type VARCHAR(16) NOT NULL,
        actor_admin_id INT NULL,
        actor_name_snapshot VARCHAR(191) NULL,
        action VARCHAR(64) NOT NULL,
        target_type VARCHAR(64) NOT NULL,
        target_id VARCHAR(191) NULL,
        change_summary JSON NULL,
        result VARCHAR(16) NOT NULL,
        error_code VARCHAR(64) NULL,
        request_id VARCHAR(64) NOT NULL,
        source_ip VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (audit_id),
        UNIQUE KEY ota_admin_audit_operation_request_part_uq (operation_id, request_id, part_no),
        KEY ota_admin_audit_actor_created_idx (actor_admin_id, created_at),
        KEY ota_admin_audit_action_created_idx (action, created_at),
        KEY ota_admin_audit_created_idx (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  private async ensureApplicationTables(
    queryRunner: QueryRunner,
    tables: ApplicationTables
  ) {
    const prefix = tables.prefix
    await this.ensureReportingTable(
      queryRunner,
      createSuccessTable({ tablePrefix: prefix })
    )
    await this.ensureReportingTable(
      queryRunner,
      createErrorTable({ tablePrefix: prefix })
    )
    await this.ensureReportingTable(
      queryRunner,
      createAppErrorLogTable({ tablePrefix: prefix })
    )
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.releaseUser}\` (
        id BIGINT NOT NULL AUTO_INCREMENT,
        release_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY \`${prefix}_release_user_release_user_uq\` (release_id, user_id),
        KEY \`${prefix}_release_user_user_release_idx\` (user_id, release_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.publishTask}\` (
        task_id VARCHAR(36) NOT NULL,
        operation_id VARCHAR(36) NOT NULL,
        release_id VARCHAR(36) NULL,
        action VARCHAR(32) NOT NULL,
        requested_revision BIGINT NOT NULL,
        status VARCHAR(16) NOT NULL,
        attempt_count INT NOT NULL DEFAULT 0,
        max_attempts INT NOT NULL DEFAULT 5,
        next_run_at DATETIME NOT NULL,
        lease_owner VARCHAR(128) NULL,
        lease_token BIGINT NOT NULL DEFAULT 0,
        lease_until DATETIME NULL,
        last_error_code VARCHAR(64) NULL,
        last_error_summary VARCHAR(512) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        PRIMARY KEY (task_id),
        UNIQUE KEY \`${prefix}_publish_task_operation_action_uq\` (operation_id, action),
        KEY \`${prefix}_publish_task_status_next_idx\` (status, next_run_at, created_at),
        KEY \`${prefix}_publish_task_status_lease_idx\` (status, lease_until),
        KEY \`${prefix}_publish_task_release_created_idx\` (release_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.publishTaskLog}\` (
        log_id VARCHAR(36) NOT NULL,
        task_id VARCHAR(36) NOT NULL,
        attempt_no INT NOT NULL,
        worker_id VARCHAR(128) NOT NULL,
        lease_token BIGINT NOT NULL,
        status VARCHAR(16) NOT NULL,
        effective_revision BIGINT NOT NULL,
        started_at DATETIME NOT NULL,
        finished_at DATETIME NULL,
        duration_ms BIGINT NULL,
        scanned_count BIGINT NOT NULL DEFAULT 0,
        eligible_count BIGINT NOT NULL DEFAULT 0,
        update_emit_count BIGINT NOT NULL DEFAULT 0,
        revoke_emit_count BIGINT NOT NULL DEFAULT 0,
        emit_error_count BIGINT NOT NULL DEFAULT 0,
        skip_summary JSON NULL,
        release_summary JSON NULL,
        error_code VARCHAR(64) NULL,
        error_summary VARCHAR(512) NULL,
        request_id VARCHAR(64) NULL,
        metrics_complete TINYINT NOT NULL DEFAULT 0,
        last_checkpoint_at DATETIME NULL,
        PRIMARY KEY (log_id),
        UNIQUE KEY \`${prefix}_publish_task_log_task_attempt_uq\` (task_id, attempt_no),
        KEY \`${prefix}_publish_task_log_task_started_idx\` (task_id, started_at),
        KEY \`${prefix}_publish_task_log_status_started_idx\` (status, started_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.auditLog}\` (
        audit_id VARCHAR(36) NOT NULL,
        operation_id VARCHAR(36) NOT NULL,
        part_no INT NOT NULL DEFAULT 1,
        actor_type VARCHAR(16) NOT NULL,
        actor_admin_id INT NULL,
        actor_name_snapshot VARCHAR(191) NULL,
        action VARCHAR(64) NOT NULL,
        target_type VARCHAR(64) NOT NULL,
        target_id VARCHAR(191) NULL,
        release_id VARCHAR(36) NULL,
        task_id VARCHAR(36) NULL,
        revision_before BIGINT NULL,
        revision_after BIGINT NULL,
        change_summary JSON NULL,
        change_detail JSON NULL,
        result VARCHAR(16) NOT NULL,
        error_code VARCHAR(64) NULL,
        request_id VARCHAR(64) NOT NULL,
        source_ip VARCHAR(64) NULL,
        created_at DATETIME NOT NULL,
        PRIMARY KEY (audit_id),
        UNIQUE KEY \`${prefix}_audit_operation_request_part_uq\` (operation_id, request_id, part_no),
        KEY \`${prefix}_audit_release_created_idx\` (release_id, created_at),
        KEY \`${prefix}_audit_actor_created_idx\` (actor_admin_id, created_at),
        KEY \`${prefix}_audit_action_created_idx\` (action, created_at),
        KEY \`${prefix}_audit_task_idx\` (task_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.releaseDraft}\` (
        release_id VARCHAR(36) NOT NULL,
        payload JSON NOT NULL,
        release_scope VARCHAR(16) NOT NULL,
        user_ids JSON NOT NULL,
        status VARCHAR(16) NOT NULL,
        published_sequence INT NULL,
        idempotency_key VARCHAR(191) NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (release_id),
        UNIQUE KEY \`${prefix}_release_draft_idempotency_uq\` (idempotency_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS \`${tables.artifact}\` (
        artifact_id VARCHAR(36) NOT NULL,
        storage_key VARCHAR(512) NOT NULL,
        url VARCHAR(2048) NOT NULL,
        size_bytes BIGINT NOT NULL,
        checksum_sha256 VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL,
        created_at DATETIME NOT NULL,
        updated_at DATETIME NOT NULL,
        PRIMARY KEY (artifact_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  private async ensureVersionTable(
    queryRunner: QueryRunner,
    tables: ApplicationTables
  ) {
    const desired = createVersionTable({ tablePrefix: tables.prefix })
    const current = await queryRunner.getTable(tables.version)
    if (!current) {
      await queryRunner.createTable(desired, true)
    } else {
      const currentColumns = new Set(current.columns.map(column => column.name))
      const missingColumns = desired.columns.filter(column => {
        return !currentColumns.has(column.name)
      })
      if (missingColumns.length) {
        await queryRunner.addColumns(tables.version, missingColumns)
      }
    }

    const invalidPrivateIdentity = (await queryRunner.query(
      `SELECT id FROM \`${tables.version}\`
       WHERE release_scope = 'allowlist' AND (release_id IS NULL OR release_id = '') LIMIT 1`
    )) as unknown[]
    if (invalidPrivateIdentity.length)
      throw new ConflictException(
        'Private release is missing its stable identity; reconcile before preparation'
      )
    await queryRunner.query(
      `UPDATE \`${tables.version}\`
       SET release_id = UUID()
       WHERE release_id IS NULL OR release_id = ''`
    )
    await queryRunner.query(
      `UPDATE \`${tables.version}\`
       SET release_scope = 'public'
       WHERE release_scope IS NULL OR release_scope = ''`
    )
    await queryRunner.query(
      `UPDATE \`${tables.version}\`
       SET policy_revision = 1
       WHERE policy_revision IS NULL OR policy_revision < 1`
    )
    const tableStatus = (await queryRunner.query(
      `SELECT AUTO_INCREMENT AS autoIncrement
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tables.version]
    )) as Array<{ autoIncrement?: number | string | null }>
    const maximumRows = (await queryRunner.query(
      `SELECT MAX(id) AS maximumId FROM \`${tables.version}\``
    )) as Array<{ maximumId?: number | string | null }>
    const nextSequence = calculateNextReleaseSequence(
      Number(tableStatus[0]?.autoIncrement),
      Number(maximumRows[0]?.maximumId)
    )
    await queryRunner.query(
      `ALTER TABLE \`${tables.version}\` AUTO_INCREMENT = ${nextSequence}`
    )
  }

  private async ensureReportingTable(
    queryRunner: QueryRunner,
    desired: ReturnType<typeof createSuccessTable>
  ) {
    const current = await queryRunner.getTable(desired.name)
    if (!current) {
      await queryRunner.createTable(desired, true)
      return
    }

    const currentColumns = new Set(current.columns.map(column => column.name))
    const missingColumns = desired.columns.filter(
      column => !currentColumns.has(column.name)
    )
    if (missingColumns.length) {
      await queryRunner.addColumns(desired.name, missingColumns)
    }
    // Historical backfill belongs to the resumable migration tool, not preparation.
  }
}
