import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApplicationMessage } from '@/entities/application-message.entity'
import { LastMessageService } from '@/messaging/last-message.service'

const socketPath = process.env.OTA_TEST_MYSQL_SOCKET
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
  it('initializes global tables and application release storage', async () => {
    const runner = source.createQueryRunner()
    try {
      expect(
        (await source.runMigrations({ transaction: 'each' })).map(m => m.name)
      ).toEqual(['InitialSchema1792713600000'])
      const globals =
        await source.query<Array<Record<string, string>>>('SHOW TABLES')
      expect(globals.flatMap(row => Object.values(row)).sort()).toEqual([
        'ota_api_key_applications',
        'ota_api_keys',
        'ota_applications',
        'ota_audit_log',
        'ota_messages',
        'ota_schema_history'
      ])
      const registry = new ApplicationRegistryService(
        source,
        new ApplicationTableResolver()
      )
      const app = await registry.prepare('fresh-app-123')
      expect(app.tablePrefix).toContain('123')
      const schema = await runner.getTable(app.tables.release)
      expect(schema?.columns.map(c => c.name)).toEqual(
        expect.arrayContaining([
          'release_sequence',
          'app_name',
          'target_version_code',
          'base_version_codes',
          'is_enabled'
        ])
      )
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
