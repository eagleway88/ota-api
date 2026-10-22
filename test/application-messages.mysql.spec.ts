import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { assertInstalledDatabase } from '@/infrastructure/persistence/installation-guard'
import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApplicationMessage } from '@/entities/application-message.entity'
import { LastMessageService } from '@/messaging/last-message.service'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('application messages on the fresh schema', () => {
  let control: DataSource, source: DataSource, database: string
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
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
    source = new DataSource({
      ...connection,
      database,
      entities: [ApplicationMessage],
      migrations: [InitialSchema1792713600000],
      migrationsTableName: 'ota_schema_history'
    })
    await source.initialize()
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (database) await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it.each(['admins', 'unique_id_message', 'app_version', 'business_sentinel'])(
    'refuses pre-existing %s without changing any data or creating tables',
    async table => {
      await source.query(
        'CREATE TABLE ' + table + ' (id INT PRIMARY KEY, content TEXT)'
      )
      await source.query('INSERT INTO ' + table + " VALUES (1,'preserve-me')")
      const runner = source.createQueryRunner()
      try {
        await expect(
          new InitialSchema1792713600000().up(runner)
        ).rejects.toThrow('fresh empty database')
        expect(await source.query('SELECT * FROM ' + table)).toEqual([
          { id: 1, content: 'preserve-me' }
        ])
        expect(await runner.hasTable('ota_installation')).toBe(false)
        expect(await runner.hasTable('ota_messages')).toBe(false)
      } finally {
        await runner.release()
      }
    }
  )
  it('rejects an unknown installation marker without repairing or overwriting it', async () => {
    await source.query('CREATE TABLE ota_installation (schema_id VARCHAR(32))')
    await source.query("INSERT INTO ota_installation VALUES ('unknown')")
    const runner = source.createQueryRunner()
    try {
      await expect(new InitialSchema1792713600000().up(runner)).rejects.toThrow(
        'Unknown database installation'
      )
      expect(await runner.hasTable('ota_messages')).toBe(false)
    } finally {
      await runner.release()
    }
  })
  it('validates initialized storage and creates only canonical app columns', async () => {
    const runner = source.createQueryRunner()
    try {
      await expect(assertInstalledDatabase(runner)).rejects.toThrow(
        'not initialized'
      )
      await source.runMigrations({ transaction: 'each' })
      await assertInstalledDatabase(runner)
      const registry = new ApplicationRegistryService(
        source,
        new ApplicationTableResolver()
      )
      const app = await registry.prepare('fresh-app-123')
      expect(app.tablePrefix).toContain('123')
      const schema = await runner.getTable(app.tables.version)
      expect(schema?.columns.map(c => c.name)).toEqual(
        expect.arrayContaining([
          'app_name',
          'target_version_code',
          'is_enabled'
        ])
      )
      for (const old of ['name', 'ver', 'enable', 'create_time'])
        expect(schema?.findColumnByName(old)).toBeUndefined()
      const audit = await runner.getTable(app.tables.auditLog)
      expect(audit?.findColumnByName('actor_admin_id')).toBeUndefined()
      expect(await source.runMigrations({ transaction: 'each' })).toEqual([])
      await source.query(
        "INSERT INTO ota_messages VALUES ('fresh-app-123','device','expired','{}',?,UTC_TIMESTAMP(6),DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 1 SECOND))",
        [randomUUID()]
      )
      const messages = new LastMessageService(
        source.getRepository(ApplicationMessage)
      )
      expect(
        await messages.queryUniqueId({
          appName: 'fresh-app-123',
          uniqueId: 'expired'
        })
      ).toBeNull()
      expect(await source.query('SELECT * FROM ota_messages')).toEqual([])
    } finally {
      await runner.release()
    }
  })

  it('initializes idempotently and isolates application/target identities', async () => {
    const runner = source.createQueryRunner()
    try {
      await new InitialSchema1792713600000().up(runner)
      await new InitialSchema1792713600000().up(runner)
    } finally {
      await runner.release()
    }
    const messages = new LastMessageService(
      source.getRepository(ApplicationMessage)
    )
    const targetId = 'app-a:windows:1'
    const user = await messages.createUserId(
      { userId: targetId, data: '{"not":"an object"}' },
      60000
    )
    const deviceA = await messages.createUniqueId(
      { appName: 'app-a', uniqueId: targetId, data: ['A'] },
      60000
    )
    const deviceB = await messages.createUniqueId(
      { appName: 'app-b', uniqueId: targetId, data: { app: 'B' } },
      60000
    )
    expect((await messages.queryUserId({ userId: targetId }))?.data).toBe(
      '{"not":"an object"}'
    )
    expect(
      (await messages.queryUniqueId({ appName: 'app-a', uniqueId: targetId }))
        ?.data
    ).toEqual(['A'])
    expect(
      (await messages.queryUniqueId({ appName: 'app-b', uniqueId: targetId }))
        ?.data
    ).toEqual({ app: 'B' })
    expect(
      await messages.ackUniqueId({
        appName: 'app-b',
        uniqueId: targetId,
        messageId: deviceA.messageId
      })
    ).toBe(false)
    expect(
      await messages.ackUserId({
        userId: targetId,
        messageId: deviceA.messageId
      })
    ).toBe(false)
    const replacement = await messages.createUniqueId(
      { appName: 'app-a', uniqueId: targetId, data: null },
      60000
    )
    expect(
      await messages.ackUniqueId({
        appName: 'app-a',
        uniqueId: targetId,
        messageId: deviceA.messageId
      })
    ).toBe(false)
    expect(
      await messages.ackUniqueId({
        appName: 'app-a',
        uniqueId: targetId,
        messageId: replacement.messageId
      })
    ).toBe(true)
    expect(
      await messages.ackUserId({ userId: targetId, messageId: user.messageId })
    ).toBe(true)
    expect(
      (await messages.queryUniqueId({ appName: 'app-b', uniqueId: targetId }))
        ?.messageId
    ).toBe(deviceB.messageId)
  })
})
