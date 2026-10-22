import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApplicationMessage } from '@/entities/application-message.entity'
import { LastMessageService } from '@/messaging/last-message.service'
import { ApplicationMessages1792445400000 } from '@/migrations/1792445400000-ApplicationMessages'
import { RetireAdministratorAccounts1792445500000 } from '@/migrations/1792445500000-RetireAdministratorAccounts'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('unified application messages and legacy credential retirement', () => {
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
      entities: [ApplicationMessage]
    })
    await source.initialize()
    for (const table of ['unique_id_message', 'user_id_message'])
      await source.query(
        `CREATE TABLE \`${table}\` (id INT PRIMARY KEY, content TEXT)`
      )
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (database) await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it.each(['unique_id_message', 'user_id_message'])(
    'refuses any DDL/drop when %s unexpectedly contains data',
    async table => {
      await source.query(`INSERT INTO \`${table}\` VALUES (1, 'preserve-me')`)
      const runner = source.createQueryRunner()
      try {
        await expect(
          new ApplicationMessages1792445400000().up(runner)
        ).rejects.toThrow('non-empty legacy table')
        expect(await runner.hasTable('ota_messages')).toBe(false)
        for (const legacy of ['unique_id_message', 'user_id_message'])
          expect(await runner.hasTable(legacy)).toBe(true)
        expect(await source.query(`SELECT content FROM \`${table}\``)).toEqual([
          { content: 'preserve-me' }
        ])
      } finally {
        await runner.release()
      }
    }
  )

  it('removes only empty legacy message tables, is retryable and isolates application/target identities', async () => {
    const runner = source.createQueryRunner()
    try {
      await new ApplicationMessages1792445400000().up(runner)
      await new ApplicationMessages1792445400000().up(runner)
      for (const legacy of ['unique_id_message', 'user_id_message'])
        expect(await runner.hasTable(legacy)).toBe(false)
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

  it('deletes approved historical accounts/sessions but keeps audit and business data', async () => {
    for (const table of [
      'admins',
      'ota_admin_sessions',
      'ota_admin_audit_log',
      'business_sentinel'
    ]) {
      await source.query(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY)`)
      await source.query(`INSERT INTO \`${table}\` VALUES (1)`)
    }
    const runner = source.createQueryRunner()
    try {
      await new RetireAdministratorAccounts1792445500000().up(runner)
      await new RetireAdministratorAccounts1792445500000().up(runner)
      expect(await runner.hasTable('admins')).toBe(false)
      expect(await runner.hasTable('ota_admin_sessions')).toBe(false)
      for (const table of ['ota_admin_audit_log', 'business_sentinel'])
        expect(await source.query(`SELECT * FROM \`${table}\``)).toEqual([
          { id: 1 }
        ])
    } finally {
      await runner.release()
    }
  })
})
