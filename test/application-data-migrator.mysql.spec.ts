import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import { legacyFingerprintFields } from '@/infrastructure/persistence/legacy/backfill-row'
import { mapStoredReleaseRecord } from '@/releases/release-record.mapper'
import { mapFormalReleaseRecord } from '@/releases/formal-release.mapper'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import {
  ApplicationDataMigrator,
  MigrationBlockedError
} from '@/infrastructure/migrations/application-data-migrator'
import { migrationSchemas } from '@/infrastructure/migrations/application-migration-audit'
import {
  applicationPreparationLock,
  MigrationOptions
} from '@/infrastructure/migrations/application-migration-contract'

// Opt-in only: never load .env, and refuse sockets outside a dedicated temporary directory.
const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('application migration with isolated MySQL', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  }
  const identity = {
    appName: 'legacy-app',
    tablePrefix: 'legacy_12ab',
    batchSize: 1
  }
  const apply: MigrationOptions = {
    ...identity,
    mode: 'apply',
    confirmedIssuedId: 4000,
    confirmBackup: true,
    confirmWritesPaused: true
  }
  const query = async (sql: string, args: unknown[] = []) =>
    source.query<Record<string, unknown>[]>(sql, args)

  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error(
        'Use only a dedicated ota-migration-mysql temporary socket'
      )
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    database = `ota_migration_test_${randomUUID().replaceAll('-', '')}`
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({
      ...connection,
      database
    })
    await source.initialize()
    const runner = source.createQueryRunner()
    try {
      await new RefactoringFoundation1792444800000().up(runner)
      await new ApplicationDataMigration1792445100000().up(runner)
      // Model a historical schema: no formal fields or unique IDs yet.
      for (const [kind, table] of Object.entries(
        migrationSchemas(identity.tablePrefix)
      )) {
        const keep: readonly string[] = [
          ...legacyFingerprintFields[
            kind as keyof typeof legacyFingerprintFields
          ],
          ...(kind === 'version' ? ['update_type'] : []),
          ...(kind === 'errorLog' ? ['error_hash', 'report_count'] : [])
        ]
        table.columns = table.columns.filter(
          column => keep.includes(column.name) && column.name !== 'report_id'
        )
        table.indices = []
        table.uniques = []
        table.engine = 'InnoDB'
        await runner.createTable(table)
      }
    } finally {
      await runner.release()
    }
    await query(
      `INSERT INTO ota_applications
      (app_name, table_prefix, schema_version, status, created_at, updated_at)
      VALUES (?, ?, 1, 'ready', NOW(), NOW())`,
      [identity.appName, identity.tablePrefix]
    )
    for (const id of [1088, 1089]) {
      await query(
        `INSERT INTO legacy_12ab_version
        (id, name, ver, base_versions, platform, architecture, enable, mandatory,
         show_dialog, package_url, update_type, create_time)
        VALUES (?, ?, 110, '1.0.0,105', 'windows', 'x64', 1, 0, 1,
          'https://example.test/app.zip', 'hot', '2020-01-01 00:00:00')`,
        [id, identity.appName]
      )
    }
    for (const kind of ['success', 'error']) {
      await query(
        `INSERT INTO legacy_12ab_${kind}
        (id, name, ver_id, ver, platform, username, extras, create_time)
        VALUES (17, ?, 1088, 100, 'windows', 'legacy-user', '{"original_key":true}', '2020-01-02 00:00:00')`,
        [identity.appName]
      )
    }
    await query(
      `INSERT INTO legacy_12ab_error_log
      (id, name, ver, platform, kind, error_hash, report_count, create_time)
      VALUES (23, ?, 100, 'windows', 'crash', 'existing-hash', 17, '2020-01-03 00:00:00')`,
      [identity.appName]
    )
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (/^ota_migration_test_[a-f0-9]{32}$/.test(database))
      await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('dry-run and verify do not add columns, checkpoints or change application state', async () => {
    const migrator = new ApplicationDataMigrator(source)
    const result = await migrator.run({ ...identity, mode: 'dry-run' })
    expect(result.status).toBe('planned')
    expect(result.plan?.tables[0].pendingRows).toBe(2)
    expect((await migrator.run({ ...identity, mode: 'verify' })).status).toBe(
      'incomplete'
    )
    expect(
      await query('SELECT * FROM ota_application_migrations')
    ).toHaveLength(0)
    expect((await query('SELECT status FROM ota_applications'))[0].status).toBe(
      'ready'
    )
    expect(
      (await query('SHOW COLUMNS FROM legacy_12ab_version')).map(
        row => row.Field
      )
    ).not.toContain('release_id')
  })

  it('resumes batches, reconciles history, activates formal reads only explicitly and never recycles issued IDs', async () => {
    const before = await query('SELECT * FROM legacy_12ab_version ORDER BY id')
    const migrator = new ApplicationDataMigrator(source)
    const paused = await migrator.run({ ...apply, maximumBatches: 1 })
    expect(paused.status).toBe('paused')
    expect(paused.progress?.version.afterId).toBe(1088)
    const first = (
      await query('SELECT release_id FROM legacy_12ab_version WHERE id = 1088')
    )[0].release_id
    const complete = await migrator.run(apply)
    expect(complete.status).toBe('completed')
    expect(
      (await query('SELECT read_model FROM ota_applications'))[0].read_model
    ).toBe('compatible')
    const after = await query('SELECT * FROM legacy_12ab_version ORDER BY id')
    expect(after[0].release_id).toBe(first)
    const decision = (row: Record<string, unknown>, formal = false) => {
      return Object.fromEntries(
        Object.entries(
          formal ? mapFormalReleaseRecord(row) : mapStoredReleaseRecord(row)
        ).filter(([key]) => key !== 'releaseId' && key !== 'legacyPayload')
      )
    }
    expect(after.map(row => decision(row, true))).toEqual(
      before.map(row => decision(row))
    )
    expect(
      (
        await query(
          'SELECT report_count, error_hash FROM legacy_12ab_error_log'
        )
      )[0]
    ).toEqual({ report_count: 17, error_hash: 'existing-hash' })
    expect(
      (
        await query(
          'SELECT id, ver_id, release_sequence, extras FROM legacy_12ab_success'
        )
      )[0]
    ).toMatchObject({
      id: 17,
      ver_id: 1088,
      release_sequence: 1088,
      extras: { original_key: true }
    })
    expect(
      (await migrator.run({ ...apply, activateFormal: true })).status
    ).toBe('completed')
    expect(
      (
        await query('SELECT read_model, schema_version FROM ota_applications')
      )[0]
    ).toMatchObject({ read_model: 'formal', schema_version: 2 })
    expect((await migrator.run({ ...identity, mode: 'verify' })).status).toBe(
      'verified'
    )
    const next = await query(
      `SELECT AUTO_INCREMENT AS nextId FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'legacy_12ab_version'`
    )
    expect(Number(next[0].nextId)).toBeGreaterThanOrEqual(4001)
    expect(
      (
        await query(
          'SELECT release_id FROM legacy_12ab_version WHERE id = 1088'
        )
      )[0].release_id
    ).toBe(first)
  })

  it('rolls back a failed batch together with its checkpoint and can resume after remediation', async () => {
    await query(`CREATE TRIGGER migration_fail BEFORE UPDATE ON legacy_12ab_version
      FOR EACH ROW BEGIN IF OLD.id = 1089 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure'; END IF; END`)
    const migrator = new ApplicationDataMigrator(source)
    await expect(
      migrator.run({ ...apply, activateFormal: true })
    ).rejects.toThrow('injected failure')
    const ledger = (
      await query('SELECT status, progress FROM ota_application_migrations')
    )[0]
    const progress =
      typeof ledger.progress === 'string'
        ? (JSON.parse(ledger.progress) as { version: { afterId: number } })
        : (ledger.progress as { version: { afterId: number } })
    expect(ledger.status).toBe('failed')
    expect(progress.version.afterId).toBe(1088)
    const data = await query(
      'SELECT release_id FROM legacy_12ab_version ORDER BY id'
    )
    expect(data[0].release_id).toBeTruthy()
    expect(data[1].release_id).toBeNull()
    expect(
      (await query('SELECT status, read_model FROM ota_applications'))[0]
    ).toMatchObject({ status: 'failed', read_model: 'compatible' })
    await query('DROP TRIGGER migration_fail')
    expect((await migrator.run(apply)).status).toBe('completed')
    expect(
      (await query('SELECT release_id FROM legacy_12ab_version ORDER BY id'))[0]
        .release_id
    ).toBe(data[0].release_id)
  })

  it('blocks ambiguous ownership before changing data or application state', async () => {
    await query(
      "UPDATE legacy_12ab_version SET name = 'other-app' WHERE id = 1089"
    )
    await expect(
      new ApplicationDataMigrator(source).run(apply)
    ).rejects.toBeInstanceOf(MigrationBlockedError)
    expect(
      await query('SELECT * FROM ota_application_migrations')
    ).toHaveLength(0)
    expect((await query('SELECT status FROM ota_applications'))[0].status).toBe(
      'ready'
    )
  })

  it('rolls back earlier row updates in the same failing batch', async () => {
    await query(`CREATE TRIGGER migration_fail BEFORE UPDATE ON legacy_12ab_version
      FOR EACH ROW BEGIN IF OLD.id = 1089 THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected failure'; END IF; END`)
    await expect(
      new ApplicationDataMigrator(source).run({ ...apply, batchSize: 2 })
    ).rejects.toThrow('injected failure')
    expect(
      await query('SELECT release_id FROM legacy_12ab_version ORDER BY id')
    ).toEqual([{ release_id: null }, { release_id: null }])
    const ledger = (
      await query(
        "SELECT JSON_EXTRACT(progress, '$.version.afterId') AS afterId FROM ota_application_migrations"
      )
    )[0]
    expect(Number(ledger.afterId)).toBe(0)
  })

  it('shares the preparation lock and refuses a competing migration before any writes', async () => {
    const holder = source.createQueryRunner()
    await holder.connect()
    const lock = applicationPreparationLock(identity.appName)
    try {
      await holder.query('SELECT GET_LOCK(?, 0)', [lock])
      await expect(
        new ApplicationDataMigrator(source).run(apply)
      ).rejects.toThrow('already running')
      expect(
        await query('SELECT * FROM ota_application_migrations')
      ).toHaveLength(0)
    } finally {
      await holder.query('SELECT RELEASE_LOCK(?)', [lock])
      await holder.release()
    }
  })

  it('does not overwrite already populated conflicting formal fields', async () => {
    await query(
      'ALTER TABLE legacy_12ab_version ADD COLUMN is_enabled TINYINT NULL'
    )
    await query('UPDATE legacy_12ab_version SET is_enabled = 0 WHERE id = 1088')
    const migrator = new ApplicationDataMigrator(source)
    const dry = await migrator.run({ ...identity, mode: 'dry-run' })
    expect(dry.status).toBe('blocked')
    expect(dry.plan?.tables[0].issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'is_enabled' })])
    )
    await expect(migrator.run(apply)).rejects.toThrow('Preflight failed')
    expect(
      (
        await query(
          'SELECT enable, is_enabled FROM legacy_12ab_version WHERE id = 1088'
        )
      )[0]
    ).toEqual({ enable: 1, is_enabled: 0 })
    expect(
      await query('SELECT * FROM ota_application_migrations')
    ).toHaveLength(0)
  })

  it('detects historical writes between batches rather than silently resetting its checkpoint', async () => {
    const migrator = new ApplicationDataMigrator(source)
    await migrator.run({ ...apply, maximumBatches: 1 })
    await query(
      "UPDATE legacy_12ab_version SET `desc` = 'uncoordinated writer' WHERE id = 1089"
    )
    await expect(migrator.run(apply)).rejects.toThrow('Historical data changed')
    expect(
      (await query('SELECT status FROM ota_application_migrations'))[0].status
    ).toBe('paused')
  })

  it('preparation leaves historical report counts and timestamps for explicit reconciliation', async () => {
    await query('UPDATE ota_applications SET schema_version = 0')
    await query('UPDATE legacy_12ab_error_log SET report_count = -1')
    const applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    await applications.prepare(identity.appName)
    expect(
      (
        await query(
          'SELECT report_count, update_time FROM legacy_12ab_error_log'
        )
      )[0]
    ).toEqual({ report_count: -1, update_time: null })
    await expect(
      new ApplicationDataMigrator(source).run(apply)
    ).rejects.toThrow('Preflight failed')
  })
})
