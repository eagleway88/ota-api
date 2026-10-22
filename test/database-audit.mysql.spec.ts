import { execFile } from 'child_process'
import { randomUUID } from 'crypto'
import { dirname, resolve } from 'path'
import { DataSource } from 'typeorm'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('read-only database audit CLI on isolated MySQL', () => {
  let control: DataSource,
    source: DataSource,
    database: string,
    user: string,
    password: string
  const root = resolve(__dirname, '..')
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
  const tables = [
    'app_version',
    'app_success',
    'app_error',
    'app_error_log',
    'appxversion',
    'appxsuccess',
    'appxerror',
    'appxerror_log',
    'app_version_backup',
    'ota_api_keys'
  ]
  const beforeRows: Record<string, unknown> = {}
  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    ) {
      throw new Error('Use only an isolated temporary MySQL socket')
    }
    control = new DataSource(connection)
    await control.initialize()
    database = 'ota_migration_test_' + randomUUID().replaceAll('-', '')
    user = 'ota_audit_' + randomUUID().replaceAll('-', '').slice(0, 12)
    password = randomUUID()
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({ ...connection, database })
    await source.initialize()
    await source.query(
      `CREATE TABLE app_version (id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, name VARCHAR(128) NOT NULL, private_body TEXT) ENGINE=InnoDB`
    )
    await source.query(
      `INSERT INTO app_version (id, name, private_body) VALUES (1005, 'example-app', 'synthetic-private-content'), (2300, 'second-app', 'synthetic-private-content')`
    )
    for (const table of tables.filter(name => name !== 'app_version')) {
      await source.query(
        `CREATE TABLE \`${table}\` (id INT PRIMARY KEY, private_body TEXT) ENGINE=InnoDB`
      )
      await source.query(
        `INSERT INTO \`${table}\` VALUES (1, 'synthetic-private-content')`
      )
    }
    for (const table of tables)
      beforeRows[table] = await source.query(
        `SELECT * FROM \`${table}\` ORDER BY id`
      )
    await control.query('CREATE USER ?@? IDENTIFIED BY ?', [
      user,
      'localhost',
      password
    ])
    // The actual CLI receives SELECT-only credentials, so writes/DDL cannot pass unnoticed.
    await control.query(
      `GRANT SELECT ON \`${database}\`.* TO '${user}'@'localhost'`
    )
  }, 30000)
  afterAll(async () => {
    if (source?.isInitialized) await source.destroy()
    if (control?.isInitialized) {
      if (database) await control.query(`DROP DATABASE \`${database}\``)
      if (user) await control.query(`DROP USER IF EXISTS '${user}'@'localhost'`)
      await control.destroy()
    }
  })

  it.each([
    undefined,
    '',
    'NO_BACKSLASH_ESCAPES',
    'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'
  ])(
    'audits exact table suffixes with SQL mode %s, without reading the project env or modifying rows',
    async mode => {
      const result = await new Promise<{
        stdout: string
        stderr: string
        code: number
      }>(done => {
        execFile(
          process.execPath,
          [
            '-r',
            require.resolve('ts-node/register'),
            '-r',
            resolve(root, 'test/fixtures/mysql-socket-preload.cjs'),
            '--',
            resolve(root, 'src/scripts/audit-database.ts')
          ],
          {
            // The private test directory has no .env; never run against the project config.
            cwd: dirname(socketPath!),
            timeout: 20000,
            env: {
              ...process.env,
              TS_NODE_PROJECT: resolve(root, 'tsconfig.json'),
              ORM_HOST: 'localhost',
              ORM_PORT: '1',
              ORM_USERNAME: user,
              ORM_PASSWORD: password,
              ORM_DATABASE: database,
              OTA_MIGRATION_TEST_SQL_MODE: mode
            }
          },
          (error, stdout, stderr) =>
            done({ stdout, stderr, code: error ? 1 : 0 })
        )
      })
      expect(result.code === 0 ? null : result.stderr).toBeNull()
      const report = JSON.parse(result.stdout) as {
        readOnly: boolean
        database: string
        dynamicTables: Array<{ tableName: string }>
        versionTables: Array<{
          tableName: string
          rowCount: number
          maximumId: number
          distinctApplicationNames: number
          missingRefactorColumns: string[]
        }>
      }
      expect(report.readOnly).toBe(true)
      expect(report.database).toBe(database)
      expect(report.dynamicTables.map(table => table.tableName).sort()).toEqual(
        ['app_version', 'app_success', 'app_error', 'app_error_log'].sort()
      )
      expect(report.versionTables).toHaveLength(1)
      expect(report.versionTables[0]).toMatchObject({
        tableName: 'app_version',
        rowCount: 2,
        maximumId: 2300,
        distinctApplicationNames: 2,
        missingRefactorColumns: [
          'release_id',
          'release_scope',
          'policy_revision',
          'target_version_code',
          'compatible_base_version_codes'
        ]
      })
      expect(result.stdout).not.toContain('synthetic-private-content')
      expect(result.stdout).not.toContain(password)
      for (const table of tables)
        expect(
          await source.query(`SELECT * FROM \`${table}\` ORDER BY id`)
        ).toEqual(beforeRows[table])
    },
    30000
  )
})
