import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApiKeyManagementService } from '@/auth/api-key-management.service'
import { ApiKeyService } from '@/auth/api-key.service'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import { ApiKeys1792445300000 } from '@/migrations/1792445300000-ApiKeys'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('API key lifecycle and additive migration on isolated MySQL', () => {
  let control: DataSource, source: DataSource, database: string
  let keys: ApiKeyManagementService, auth: ApiKeyService
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
  const context = {
    requestId: 'cli-test',
    actorType: 'operator' as const,
    actorName: 'test-operator'
  }
  const create = () =>
    keys.create(
      {
        name: 'shared CI',
        applications: ['app-a', 'app-b'],
        preset: 'full',
        expiresAt: null
      },
      context
    )
  const query = (sql: string, args: unknown[] = []) =>
    source.query<Array<Record<string, unknown>>>(sql, args)
  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    database = 'ota_migration_test_' + randomUUID().replaceAll('-', '')
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({ ...connection, database })
    await source.initialize()
    const runner = source.createQueryRunner()
    try {
      await new RefactoringFoundation1792444800000().up(runner)
      await new ApplicationDataMigration1792445100000().up(runner)
    } finally {
      await runner.release()
    }
    const applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    await applications.prepare('app-a')
    await applications.prepare('app-b')
    const migration = source.createQueryRunner()
    try {
      await new ApiKeys1792445300000().up(migration)
    } finally {
      await migration.release()
    }
    keys = new ApiKeyManagementService(source)
    auth = new ApiKeyService(source)
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (database) await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('issues one permanent key for two applications, persists only its digest, and authenticates it', async () => {
    const key = await create()
    expect(await auth.authenticate(key.accessKey)).toMatchObject({
      keyId: key.keyId,
      preset: 'full',
      applications: expect.arrayContaining(['app-a', 'app-b']) as unknown
    })
    expect(await query('SELECT * FROM ota_api_key_applications')).toHaveLength(
      2
    )
    const stored = await query('SELECT * FROM ota_api_keys')
    expect(stored[0].expires_at).toBeNull()
    expect(JSON.stringify(stored)).not.toContain(key.accessKey.split('.')[1])
    expect(await keys.inspect(key.keyId)).not.toHaveProperty('secret_hash')
    expect(JSON.stringify(await keys.list())).not.toContain(key.accessKey)
  })
  it('rejects unknown, wrong-secret, malformed and old JWT credentials', async () => {
    const key = await create()
    for (const value of [
      'old.jwt.token',
      key.accessKey + 'x',
      key.accessKey.replace(/\.[^.]+$/, '.' + 'a'.repeat(43)),
      'ota_ak_bad'
    ]) {
      await expect(auth.authenticate(value)).rejects.toThrow(
        'Invalid access key'
      )
    }
  })
  it('supports expiry and immediate idempotent revocation without restarting', async () => {
    const key = await create()
    await keys.revoke(key.keyId, context)
    await keys.revoke(key.keyId, context)
    await expect(auth.authenticate(key.accessKey)).rejects.toThrow(
      'Invalid access key'
    )
    expect(
      await query(
        "SELECT * FROM ota_admin_audit_log WHERE action = 'api_key_revoked'"
      )
    ).toHaveLength(1)
    const expiring = await keys.create(
      {
        name: 'temporary',
        applications: ['app-a'],
        preset: 'observer',
        expiresAt: new Date(Date.now() + 60000)
      },
      context
    )
    await auth.authenticate(expiring.accessKey)
    await source.query(
      'UPDATE ota_api_keys SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE key_id = ?',
      [expiring.keyId]
    )
    await expect(auth.authenticate(expiring.accessKey)).rejects.toThrow(
      'Invalid access key'
    )
  })
  it('never silently grants unknown, unprepared or wildcard applications', async () => {
    for (const app of ['missing', '*'])
      await expect(
        keys.create(
          {
            name: 'bad',
            applications: ['app-a', app],
            preset: 'full',
            expiresAt: null
          },
          context
        )
      ).rejects.toThrow()
    expect(await query('SELECT * FROM ota_api_keys')).toEqual([])
  })
  it('does not broaden a full key to newly registered applications', async () => {
    const key = await create()
    await new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    ).prepare('app-c')
    expect(
      [...(await auth.authenticate(key.accessKey)).applications].sort()
    ).toEqual(['app-a', 'app-b'])
  })
  it('keeps sibling credentials independent and filters metadata by an exact application', async () => {
    const key = await create()
    const sibling = await keys.create(
      {
        name: 'other',
        applications: ['app-a'],
        preset: 'observer',
        expiresAt: null
      },
      context
    )
    await keys.revoke(key.keyId, context)
    await auth.authenticate(sibling.accessKey)
    expect(await keys.list('app-b')).toHaveLength(1)
    expect(await keys.list('app-a')).toHaveLength(2)
    expect(await keys.list('APP-A')).toHaveLength(0)
  })
  it('atomically rolls back creation and grants when the audit fails', async () => {
    await source.query(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON ota_admin_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'"
    )
    await expect(create()).rejects.toThrow()
    expect(await query('SELECT * FROM ota_api_keys')).toEqual([])
    expect(await query('SELECT * FROM ota_api_key_applications')).toEqual([])
  })
  it('rolls back revocation if its audit fails and never logs plaintext credentials', async () => {
    const key = await create()
    const audits = JSON.stringify(
      await query('SELECT * FROM ota_admin_audit_log')
    )
    expect(audits).not.toContain(key.accessKey.split('.')[1])
    await source.query(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON ota_admin_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'"
    )
    await expect(keys.revoke(key.keyId, context)).rejects.toThrow()
    await auth.authenticate(key.accessKey)
  })
  it('upgrades existing audit tables idempotently and preserves previous rows and app data', async () => {
    const before = await query('SELECT * FROM ota_admin_audit_log')
    await source.query(
      'ALTER TABLE app_a_audit_log DROP INDEX app_a_audit_key_created_idx, DROP COLUMN actor_key_id'
    )
    const runner = source.createQueryRunner()
    try {
      await new ApiKeys1792445300000().up(runner)
      expect(await runner.hasColumn('app_a_audit_log', 'actor_key_id')).toBe(
        true
      )
      expect(
        await runner.hasColumn('ota_admin_audit_log', 'actor_key_id')
      ).toBe(true)
    } finally {
      await runner.release()
    }
    expect(await query('SELECT * FROM ota_admin_audit_log')).toEqual(before)
    expect(await query('SELECT * FROM ota_applications')).toHaveLength(2)
  })

  it('prepares a late-registered historical app with an existing old audit schema', async () => {
    await source.query('CREATE TABLE late_app_audit_log LIKE app_a_audit_log')
    await source.query(
      'ALTER TABLE late_app_audit_log DROP INDEX app_a_audit_key_created_idx, DROP COLUMN actor_key_id'
    )
    await source.query(
      `INSERT INTO ota_applications (app_name, table_prefix, schema_version, status, created_at, updated_at) VALUES ('late-app', 'late_app', 0, 'preparing', NOW(), NOW())`
    )
    await new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    ).prepare('late-app')
    const runner = source.createQueryRunner()
    try {
      expect(await runner.hasColumn('late_app_audit_log', 'actor_key_id')).toBe(
        true
      )
    } finally {
      await runner.release()
    }
    const key = await keys.create(
      {
        name: 'late-app CI',
        applications: ['late-app'],
        preset: 'full',
        expiresAt: null
      },
      context
    )
    expect((await auth.authenticate(key.accessKey)).applications).toEqual([
      'late-app'
    ])
  })
})
