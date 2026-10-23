import { ConflictException, Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationTables,
  ApplicationTableResolver
} from '@/infrastructure/persistence/application-table-resolver'
import {
  createAppErrorLogTable,
  createErrorTable,
  createSuccessTable,
  createReleaseTable
} from '@/infrastructure/persistence/application-schema'
import { randomUUID } from 'crypto'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'
import { applicationPreparationLock } from '@/infrastructure/persistence/application-lock'

export type RegisteredApplication = {
  appName: string
  tablePrefix: string
  schemaVersion: number
  status: 'preparing' | 'ready' | 'failed'
  tables: ApplicationTables
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

  /** HTTP operations never register applications or prepare schemas. */
  async requireReady(appName: string): Promise<RegisteredApplication> {
    const app = await this.resolve(appName)
    if (app.status !== 'ready' || app.schemaVersion < 1) {
      throw new ConflictException(
        'Application is not ready; use the operational CLI to prepare it first'
      )
    }
    return app
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
    if (!row)
      throw new ConflictException(
        'Application is not registered; prepare it using the CLI'
      )
    const tablePrefix = String(row.table_prefix)
    const catalogRevision = Number(row.catalog_revision)
    if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 0) {
      throw new ConflictException('Application catalog revision is invalid')
    }
    if (
      !Number.isSafeInteger(Number(row.schema_version)) ||
      Number(row.schema_version) < 0 ||
      !['ready', 'preparing', 'failed'].includes(String(row.status))
    )
      throw new ConflictException('Invalid application schema state')
    return {
      appName,
      tablePrefix,
      schemaVersion: Number(row.schema_version),
      status: String(row.status) as RegisteredApplication['status'],
      tables: this.tableResolver.resolve(appName, tablePrefix),
      catalogRevision
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
      shouldMarkFailure = true
      if (
        !(await queryRunner.hasTable('ota_applications')) ||
        !(await queryRunner.hasTable('ota_audit_log'))
      )
        throw new ConflictException(
          'Initialize a fresh database with the CLI first'
        )
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
      await this.ensureReleaseTable(queryRunner, tables)
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
      if (shouldMarkFailure && (await queryRunner.hasTable('ota_audit_log'))) {
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
        actor_key_id VARCHAR(36) NULL,
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
        KEY \`${prefix}_audit_key_created_idx\` (actor_key_id, created_at),
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

  private async ensureReleaseTable(
    runner: QueryRunner,
    tables: ApplicationTables
  ) {
    const desired = createReleaseTable({ tablePrefix: tables.prefix })
    const existing = await runner.getTable(desired.name)
    if (existing) {
      this.assertSchema(
        existing.columns.map(c => c.name),
        desired.columns.map(c => c.name)
      )
      return
    }
    await runner.createTable(desired)
  }
  private assertSchema(actual: string[], expected: string[]) {
    if (expected.some(n => !actual.includes(n)))
      throw new ConflictException('Application schema is incomplete')
  }
  private async ensureReportingTable(
    runner: QueryRunner,
    desired: ReturnType<typeof createSuccessTable>
  ) {
    const existing = await runner.getTable(desired.name)
    if (existing)
      this.assertSchema(
        existing.columns.map(c => c.name),
        desired.columns.map(c => c.name)
      )
    else await runner.createTable(desired)
  }
}
