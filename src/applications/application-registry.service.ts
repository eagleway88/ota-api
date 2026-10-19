import { ConflictException, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationTables,
  ApplicationTableResolver
} from '@/infrastructure/persistence/application-table-resolver'
import {
  calculateNextReleaseSequence,
  createVersionTable
} from '@/utils/version'

export type RegisteredApplication = {
  appName: string
  tablePrefix: string
  schemaVersion: number
  status: 'preparing' | 'ready' | 'failed'
  tables: ApplicationTables
}

@Injectable()
export class ApplicationRegistryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly tableResolver: ApplicationTableResolver
  ) {}

  async resolve(appName: string): Promise<RegisteredApplication> {
    this.tableResolver.validateAppName(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable('ota_applications'))) {
        const tablePrefix = this.tableResolver.legacyPrefix(appName)
        return {
          appName,
          tablePrefix,
          schemaVersion: 0,
          status: 'preparing',
          tables: this.tableResolver.resolve(appName, tablePrefix)
        }
      }
      const row = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from('ota_applications', 'application')
        .where('application.app_name = :appName', { appName })
        .getRawOne<Record<string, unknown>>()
      const tablePrefix = row
        ? String(row.table_prefix)
        : this.tableResolver.legacyPrefix(appName)
      return {
        appName,
        tablePrefix,
        schemaVersion: row ? Number(row.schema_version) : 0,
        status: row
          ? (String(row.status) as RegisteredApplication['status'])
          : 'preparing',
        tables: this.tableResolver.resolve(appName, tablePrefix)
      }
    } finally {
      await queryRunner.release()
    }
  }

  async prepare(appName: string): Promise<RegisteredApplication> {
    this.tableResolver.validateAppName(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      await this.ensureGlobalTables(queryRunner)
      await queryRunner.startTransaction()
      let tablePrefix: string
      try {
        const existing = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from('ota_applications', 'application')
          .setLock('pessimistic_write')
          .where('application.app_name = :appName', { appName })
          .getRawOne<Record<string, unknown>>()
        tablePrefix = existing
          ? String(existing.table_prefix)
          : await this.allocatePrefix(queryRunner, appName)
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

      const tables = this.tableResolver.resolve(appName, tablePrefix)
      await this.ensureVersionTable(queryRunner, appName, tables)
      await this.ensureApplicationTables(queryRunner, tables)
      await queryRunner.manager
        .createQueryBuilder()
        .update('ota_applications')
        .set({ schema_version: 1, status: 'ready', updated_at: new Date() })
        .where('app_name = :appName', { appName })
        .execute()

      return {
        appName,
        tablePrefix,
        schemaVersion: 1,
        status: 'ready',
        tables
      }
    } catch (error) {
      if (await queryRunner.hasTable('ota_applications')) {
        await queryRunner.manager
          .createQueryBuilder()
          .update('ota_applications')
          .set({ status: 'failed', updated_at: new Date() })
          .where('app_name = :appName', { appName })
          .execute()
      }
      throw error
    } finally {
      await queryRunner.release()
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
        UNIQUE KEY ota_admin_audit_operation_request_part_uq (operation_id, request_id, part_no)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    `)
  }

  private async ensureApplicationTables(
    queryRunner: QueryRunner,
    tables: ApplicationTables
  ) {
    const prefix = tables.prefix
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
    appName: string,
    tables: ApplicationTables
  ) {
    const desired = createVersionTable(appName)
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

    await queryRunner.query(
      `UPDATE \`${tables.version}\`
       SET release_id = UUID()
       WHERE release_id IS NULL OR release_id = ''`
    )
    await queryRunner.query(
      `UPDATE \`${tables.version}\`
       SET release_scope = 'public', policy_revision = 1
       WHERE release_scope IS NULL OR release_scope = '' OR policy_revision IS NULL OR policy_revision < 1`
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
}
