import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApiKeyManagementService } from '@/auth/api-key-management.service'
import { ApiKeyService } from '@/auth/api-key.service'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

const socketPath = process.env.OTA_TEST_MYSQL_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('API key lifecycle on the fresh schema on isolated MySQL', () => {
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
  const prepare = async (...names: string[]) => {
    const registry = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    for (const name of names) await registry.prepare(name)
  }
  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-test-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    database = 'ota_test_' + randomUUID().replaceAll('-', '')
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({ ...connection, database })
    await source.initialize()
    const runner = source.createQueryRunner()
    try {
      await new InitialSchema1792713600000().up(runner)
    } finally {
      await runner.release()
    }
    const applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    await applications.prepare('app-a')
    await applications.prepare('app-b')
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
  it('rejects unknown, malformed and wrong-secret credentials', async () => {
    const key = await create()
    for (const value of [
      'invalid-credential',
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
        "SELECT * FROM ota_audit_log WHERE action = 'api_key_revoked'"
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
      "CREATE TRIGGER fail_audit BEFORE INSERT ON ota_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'"
    )
    await expect(create()).rejects.toThrow()
    expect(await query('SELECT * FROM ota_api_keys')).toEqual([])
    expect(await query('SELECT * FROM ota_api_key_applications')).toEqual([])
  })
  it('rolls back revocation if its audit fails and never logs plaintext credentials', async () => {
    const key = await create()
    const audits = JSON.stringify(await query('SELECT * FROM ota_audit_log'))
    expect(audits).not.toContain(key.accessKey.split('.')[1])
    await source.query(
      "CREATE TRIGGER fail_audit BEFORE INSERT ON ota_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'"
    )
    await expect(keys.revoke(key.keyId, context)).rejects.toThrow()
    await auth.authenticate(key.accessKey)
  })
  it('updates scope without rotating the secret or changing metadata, preset or sibling keys', async () => {
    const key = await create()
    const sibling = await create()
    const stored = await query('SELECT * FROM ota_api_keys WHERE key_id = ?', [
      key.keyId
    ])
    await prepare('app-c')
    expect(
      await keys.grantApplications(key.keyId, ['app-c', 'app-a'], context)
    ).toEqual({
      keyId: key.keyId,
      applications: ['app-a', 'app-b', 'app-c'],
      addedApplications: ['app-c'],
      removedApplications: []
    })
    expect(
      await keys.ungrantApplications(key.keyId, ['app-b'], context)
    ).toEqual({
      keyId: key.keyId,
      applications: ['app-a', 'app-c'],
      addedApplications: [],
      removedApplications: ['app-b']
    })
    expect(
      [...(await auth.authenticate(key.accessKey)).applications].sort()
    ).toEqual(['app-a', 'app-c'])
    expect(
      [...(await auth.authenticate(sibling.accessKey)).applications].sort()
    ).toEqual(['app-a', 'app-b'])
    expect(
      await query('SELECT * FROM ota_api_keys WHERE key_id = ?', [key.keyId])
    ).toEqual(stored)
    expect(await keys.inspect(key.keyId)).toMatchObject({
      preset: 'full',
      applications: ['app-a', 'app-c']
    })
    expect((await keys.list('app-c')).map(row => row.keyId)).toEqual([
      key.keyId
    ])
    expect((await keys.list('app-b')).map(row => row.keyId)).toEqual([
      sibling.keyId
    ])
    expect(
      await query(
        "SELECT status FROM ota_applications WHERE app_name = 'app-b'"
      )
    ).toEqual([{ status: 'ready' }])
    expect(await query('SELECT release_sequence FROM app_b_release')).toEqual(
      []
    )
  })
  it('audits actual deltas atomically and makes repeated scope commands idempotent', async () => {
    const key = await create()
    await prepare('app-c')
    await keys.grantApplications(key.keyId, ['app-c'], context)
    expect(
      await keys.grantApplications(key.keyId, ['app-c'], context)
    ).toMatchObject({ addedApplications: [], removedApplications: [] })
    await keys.ungrantApplications(key.keyId, ['app-b'], context)
    expect(
      await keys.ungrantApplications(key.keyId, ['app-b', 'missing'], context)
    ).toMatchObject({ addedApplications: [], removedApplications: [] })
    const audits = await query(
      "SELECT * FROM ota_audit_log WHERE action IN ('api_key_applications_granted', 'api_key_applications_ungranted')"
    )
    expect(audits).toHaveLength(2)
    for (const row of audits) {
      expect(row).toMatchObject({
        actor_type: 'operator',
        actor_name_snapshot: context.actorName,
        target_type: 'api_key',
        target_id: key.keyId,
        request_id: context.requestId,
        result: 'succeeded'
      })
      const summary: unknown =
        typeof row.change_summary === 'string'
          ? JSON.parse(row.change_summary)
          : row.change_summary
      expect(summary).toEqual(
        row.action === 'api_key_applications_granted'
          ? {
              applicationsBefore: ['app-a', 'app-b'],
              applicationsAfter: ['app-a', 'app-b', 'app-c'],
              addedApplications: ['app-c'],
              removedApplications: []
            }
          : {
              applicationsBefore: ['app-a', 'app-b', 'app-c'],
              applicationsAfter: ['app-a', 'app-c'],
              addedApplications: [],
              removedApplications: ['app-b']
            }
      )
    }
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain(key.accessKey.split('.')[1])
    expect(serialized).not.toContain('secret_hash')
    expect(serialized).not.toContain('accessKey')
  })
  it('can remove all applications and later regrant access to the same credential', async () => {
    const key = await create()
    expect(
      await keys.ungrantApplications(key.keyId, ['app-a', 'app-b'], context)
    ).toMatchObject({
      applications: [],
      removedApplications: ['app-a', 'app-b']
    })
    expect(await auth.authenticate(key.accessKey)).toMatchObject({
      keyId: key.keyId,
      applications: []
    })
    expect(await keys.inspect(key.keyId)).toMatchObject({
      status: 'active',
      applications: []
    })
    await keys.grantApplications(key.keyId, ['app-b'], context)
    expect(await auth.authenticate(key.accessKey)).toMatchObject({
      applications: ['app-b']
    })
  })
  it('rejects malformed, duplicate, unknown, case-variant and unready grants without partial changes', async () => {
    const key = await create()
    await prepare('app-c', 'app-d')
    await source.query(
      "UPDATE ota_applications SET status = 'preparing' WHERE app_name = 'app-c'"
    )
    for (const apps of [
      ['app-d', 'missing'],
      ['APP-A'],
      ['app-c'],
      ['*'],
      [],
      ['app-a', 'app-a']
    ])
      await expect(
        keys.grantApplications(key.keyId, apps, context)
      ).rejects.toThrow()
    await source.query(
      "UPDATE ota_applications SET status = 'ready', schema_version = 0 WHERE app_name = 'app-c'"
    )
    await expect(
      keys.grantApplications(key.keyId, ['app-c'], context)
    ).rejects.toThrow('registered and ready')
    for (const method of [
      'grantApplications',
      'ungrantApplications'
    ] as const) {
      await expect(keys[method]('invalid', ['app-d'], context)).rejects.toThrow(
        'Invalid key ID'
      )
      await expect(
        keys[method](randomUUID(), ['app-d'], context)
      ).rejects.toThrow('not found')
      await expect(keys[method](key.keyId, ['*'], context)).rejects.toThrow()
    }
    expect(await keys.inspect(key.keyId)).toMatchObject({
      applications: ['app-a', 'app-b']
    })
    expect(
      await query(
        "SELECT * FROM ota_audit_log WHERE target_id = ? AND action <> 'api_key_created'",
        [key.keyId]
      )
    ).toEqual([])
  })
  it.each(['revoked', 'expired'])(
    'rejects scope changes for a %s key',
    async state => {
      const key = await create()
      if (state === 'revoked') await keys.revoke(key.keyId, context)
      else
        await source.query(
          'UPDATE ota_api_keys SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE key_id = ?',
          [key.keyId]
        )
      for (const method of [
        'grantApplications',
        'ungrantApplications'
      ] as const)
        await expect(
          keys[method](key.keyId, ['app-a'], context)
        ).rejects.toThrow('revoked or expired')
      expect(await keys.inspect(key.keyId)).toMatchObject({
        status: state,
        applications: ['app-a', 'app-b']
      })
    }
  )
  it.each(['grantApplications', 'ungrantApplications'] as const)(
    'rolls back %s if its audit cannot be written',
    async method => {
      const key = await create()
      await prepare('app-c')
      await source.query(
        "CREATE TRIGGER fail_scope_audit BEFORE INSERT ON ota_audit_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected'"
      )
      await expect(
        keys[method](
          key.keyId,
          [method === 'grantApplications' ? 'app-c' : 'app-a'],
          context
        )
      ).rejects.toThrow()
      expect(await keys.inspect(key.keyId)).toMatchObject({
        applications: ['app-a', 'app-b']
      })
      await auth.authenticate(key.accessKey)
      expect(
        await query('SELECT * FROM ota_audit_log WHERE target_id = ?', [
          key.keyId
        ])
      ).toHaveLength(1)
    }
  )
  it('serializes concurrent grants and removals without lost updates', async () => {
    const key = await create()
    await prepare('app-c', 'app-d')
    await Promise.all([
      keys.grantApplications(key.keyId, ['app-c'], context),
      keys.grantApplications(key.keyId, ['app-d'], context)
    ])
    expect(await keys.inspect(key.keyId)).toMatchObject({
      applications: ['app-a', 'app-b', 'app-c', 'app-d']
    })
    await Promise.all([
      keys.ungrantApplications(key.keyId, ['app-a'], context),
      keys.ungrantApplications(key.keyId, ['app-b'], context),
      keys.grantApplications(key.keyId, ['app-c'], context)
    ])
    expect(await keys.inspect(key.keyId)).toMatchObject({
      applications: ['app-c', 'app-d']
    })
  })
  it('never resurrects a key when scope updates race with revocation', async () => {
    const key = await create()
    await prepare('app-c')
    const results = await Promise.allSettled([
      keys.grantApplications(key.keyId, ['app-c'], context),
      keys.revoke(key.keyId, context)
    ])
    expect(results[1].status).toBe('fulfilled')
    if (results[0].status === 'rejected')
      expect(String(results[0].reason)).toContain('revoked or expired')
    expect(await keys.inspect(key.keyId)).toMatchObject({ status: 'revoked' })
    await expect(auth.authenticate(key.accessKey)).rejects.toThrow(
      'Invalid access key'
    )
    await expect(
      keys.grantApplications(key.keyId, ['app-a'], context)
    ).rejects.toThrow('revoked or expired')
  })
  it('limits total grants across commands, not just the size of each request', async () => {
    const key = await create()
    // Registry-only fixtures: this test exercises authorization, not application DDL.
    const apps = Array.from(
      { length: 99 },
      (_, i) => 'scope-' + String(i).padStart(3, '0')
    )
    await source.query(
      `INSERT INTO ota_applications
      (app_name, table_prefix, schema_version, status, created_at, updated_at)
      VALUES ${apps.map(() => "(?, ?, 1, 'ready', UTC_TIMESTAMP(), UTC_TIMESTAMP())").join(',')}`,
      apps.flatMap(app => [app, app.replace('-', '_')])
    )
    await keys.grantApplications(key.keyId, apps.slice(0, 98), context)
    await expect(
      keys.grantApplications(key.keyId, [apps[98]], context)
    ).rejects.toThrow('at most 100')
    expect((await keys.inspect(key.keyId)).applications).toHaveLength(100)
    await keys.ungrantApplications(key.keyId, ['app-a'], context)
    await keys.grantApplications(key.keyId, [apps[98]], context)
    expect((await keys.inspect(key.keyId)).applications).toHaveLength(100)
    expect(
      await query(
        "SELECT * FROM ota_audit_log WHERE action = 'api_key_applications_granted'"
      )
    ).toHaveLength(2)
  })
})
