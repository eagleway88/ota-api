import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { resolve } from 'path'
import { DataSource } from 'typeorm'
import { ApiKeyService } from '@/auth/api-key.service'

const socketPath = process.env.OTA_TEST_MYSQL_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('operational CLI with real subprocesses and isolated MySQL', () => {
  let control: DataSource,
    source: DataSource,
    database: string,
    user: string,
    password: string
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
  const run = (args: string[]) =>
    new Promise<{ stdout: string; stderr: string; code: number }>(done => {
      execFile(
        process.execPath,
        [
          '-r',
          'ts-node/register',
          '-r',
          'tsconfig-paths/register',
          '-r',
          './test/fixtures/mysql-socket-preload.cjs',
          '--',
          'src/scripts/ota.ts',
          ...args,
          '--env-file',
          socketPath!.replace('mysql.sock', 'absent-test.env')
        ],
        {
          cwd: resolve(__dirname, '..'),
          timeout: 20000,
          env: {
            ...process.env,
            ORM_HOST: 'localhost',
            ORM_PORT: '3306',
            ORM_USERNAME: user,
            ORM_PASSWORD: password,
            ORM_DATABASE: database
          }
        },
        (error, stdout, stderr) => done({ stdout, stderr, code: error ? 1 : 0 })
      )
    })
  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-test-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
    database = 'ota_test_' + randomUUID().replaceAll('-', '')
    user = 'ota_cli_' + randomUUID().replaceAll('-', '').slice(0, 12)
    password = randomUUID()
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({
      ...connection,
      database,
      migrations: [InitialSchema1792713600000],
      migrationsTableName: 'ota_schema_history'
    })
    await source.initialize()
    await control.query('CREATE USER ?@? IDENTIFIED BY ?', [
      user,
      'localhost',
      password
    ])
    // Identifiers are generated exclusively from the fixed test prefix and UUID hex.
    await control.query(
      `GRANT ALL ON \`${database}\`.* TO '${user}'@'localhost'`
    )
    const initialized = await run(['db', 'init', '--database', database])
    expect(initialized.code === 0 ? null : initialized.stderr).toBeNull()
    expect(JSON.parse(initialized.stdout)).toMatchObject({
      database,
      migrations: ['InitialSchema1792713600000']
    })
    expect(
      (
        JSON.parse(
          (await run(['db', 'init', '--database', database])).stdout
        ) as { migrations: string[] }
      ).migrations
    ).toEqual([])
  }, 30000)
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy()
    if (control?.isInitialized) {
      if (database) await control.query(`DROP DATABASE \`${database}\``)
      if (user) await control.query(`DROP USER IF EXISTS '${user}'@'localhost'`)
      await control.destroy()
    }
  })

  it('prepares multiple applications, issues a full key once, lists/inspects without secrets and revokes it', async () => {
    const created = await run([
      'key',
      'create',
      '--apps',
      'cli-a,cli-b',
      '--name',
      'release CI',
      '--preset',
      'full',
      '--no-expiry',
      '--prepare-apps',
      '--database',
      database
    ])
    expect(created.code === 0 ? null : created.stderr).toBeNull()
    const key = (
      JSON.parse(created.stdout) as {
        result: { keyId: string; accessKey: string }
      }
    ).result
    const principal = await new ApiKeyService(source).authenticate(
      key.accessKey
    )
    expect([...principal.applications].sort()).toEqual(['cli-a', 'cli-b'])
    expect(principal.preset).toBe('full')
    expect(created.stderr).not.toContain(key.accessKey)
    const reinitialized = await run(['db', 'init', '--database', database])
    expect(reinitialized.code === 0 ? null : reinitialized.stderr).toBeNull()
    expect(JSON.parse(reinitialized.stdout)).toEqual({
      database,
      migrations: []
    })
    expect(
      await new ApiKeyService(source).authenticate(key.accessKey)
    ).toMatchObject({ keyId: key.keyId })
    const listing = await run(['key', 'list', '--app', 'cli-a'])
    const inspected = await run(['key', 'inspect', '--id', key.keyId])
    for (const result of [listing, inspected]) {
      expect(result.code).toBe(0)
      expect(result.stdout).toContain(key.keyId)
      expect(result.stdout).not.toContain(key.accessKey.split('.')[1])
      expect(result.stdout).not.toContain('secret_hash')
    }
    expect(
      (await run(['key', 'revoke', '--id', key.keyId, '--database', database]))
        .code
    ).toBe(0)
    await expect(
      new ApiKeyService(source).authenticate(key.accessKey)
    ).rejects.toThrow('Invalid access key')
    expect(await source.runMigrations()).toEqual([])
  }, 30000)
  it('never initializes ungranted/unprepared apps implicitly or writes to a mismatched database', async () => {
    const args = [
      'key',
      'create',
      '--apps',
      'must-not-be-created',
      '--name',
      'invalid',
      '--preset',
      'observer',
      '--no-expiry',
      '--database',
      database
    ]
    expect((await run(args)).code).toBe(1)
    const wrong = [...args, '--prepare-apps']
    wrong[wrong.indexOf('--database') + 1] = 'unconfirmed-database'
    expect((await run(wrong)).code).toBe(1)
    expect(
      await source.query(
        "SELECT * FROM ota_applications WHERE app_name = 'must-not-be-created'"
      )
    ).toEqual([])
  }, 30000)
  it('retains prepared application tables, without issuing a credential, when key audit creation fails', async () => {
    await source.query(`CREATE TRIGGER reject_key_audit BEFORE INSERT ON ota_audit_log FOR EACH ROW
      BEGIN IF NEW.action = 'api_key_created' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected audit failure'; END IF; END`)
    try {
      const result = await run([
        'key',
        'create',
        '--apps',
        'prepared-without-key',
        '--name',
        'failed issuance',
        '--preset',
        'full',
        '--no-expiry',
        '--prepare-apps',
        '--database',
        database
      ])
      expect(result.code).toBe(1)
      expect(result.stdout).not.toContain('ota_ak_')
      expect(
        await source.query(
          "SELECT status FROM ota_applications WHERE app_name = 'prepared-without-key'"
        )
      ).toEqual([{ status: 'ready' }])
      expect(
        await source.query(
          "SELECT * FROM ota_api_keys WHERE name = 'failed issuance'"
        )
      ).toEqual([])
    } finally {
      await source.query('DROP TRIGGER reject_key_audit')
    }
  }, 30000)
})
