import { createHash } from 'crypto'
import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import * as dotenv from 'dotenv'
import { randomUUID } from 'crypto'
import { userInfo } from 'os'
import { DataSource } from 'typeorm'
import { ApiKeyManagementService } from '@/auth/api-key-management.service'
import { parseOtaArguments, otaHelp } from './ota-options'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { AuditQueryService } from '@/manage/audit/audit.service'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(otaHelp + '\n')
    return
  }
  const options = parseOtaArguments(args)
  dotenv.config({ path: options.envFile, quiet: true })
  const required = (name: string) => {
    const v = process.env[name]
    if (!v) throw new Error(`Missing configuration: ${name}`)
    return v
  }
  const database = required('ORM_DATABASE')
  if (options.database && options.database !== database)
    throw new Error('Confirmed database does not match configuration')
  const source = new DataSource({
    type: 'mysql',
    host: required('ORM_HOST'),
    port: Number(process.env.ORM_PORT ?? 3306),
    username: required('ORM_USERNAME'),
    password: required('ORM_PASSWORD'),
    database,
    logging: false,
    synchronize: false,
    dateStrings: true,
    migrations: [InitialSchema1792713600000],
    migrationsTableName: 'ota_schema_history'
  })
  try {
    await source.initialize()
    if (options.command === 'db:init') {
      const runner = source.createQueryRunner()
      await runner.connect()
      let acquired = false
      const lock =
        'ota_init_' +
        createHash('sha256').update(database).digest('hex').slice(0, 40)
      try {
        const rows = (await runner.query('SELECT GET_LOCK(?, 30) AS acquired', [
          lock
        ])) as Array<{ acquired: number | string }>
        acquired = Number(rows[0]?.acquired) === 1
        if (!acquired) throw new Error('Database initialization is busy')
        const migrations = await source.runMigrations({ transaction: 'each' })
        process.stdout.write(
          JSON.stringify({
            database,
            migrations: migrations.map(m => m.name)
          }) + '\n'
        )
      } finally {
        try {
          if (acquired) await runner.query('SELECT RELEASE_LOCK(?)', [lock])
        } finally {
          await runner.release()
        }
      }
      return
    }
    // Never start application DDL before initialization is complete.
    await source.query('SELECT key_id FROM ota_api_keys LIMIT 0')
    await source.query(
      'SELECT key_id, app_name FROM ota_api_key_applications LIMIT 0'
    )
    await source.query('SELECT actor_key_id FROM ota_audit_log LIMIT 0')
    const keys = new ApiKeyManagementService(source)
    const context = {
      requestId: 'cli:' + randomUUID(),
      actorType: 'operator' as const,
      actorName: userInfo().username
    }
    const applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    let result: unknown
    switch (options.command) {
      case 'key:create':
        if (options.prepareApplications) {
          for (const app of options.applications!) {
            await applications.prepare(app, context)
            process.stderr.write(`Application prepared: ${app}\n`)
          }
        }
        result = await keys.create(
          {
            name: options.name!,
            applications: options.applications!,
            preset: options.preset!,
            expiresAt: options.expiresAt!
          },
          context
        )
        break
      case 'key:list':
        result = await keys.list(options.app)
        break
      case 'key:inspect':
        result = await keys.inspect(options.keyId!)
        break
      case 'key:revoke':
        result = await keys.revoke(options.keyId!, context)
        break
      case 'app:prepare':
        result = await applications.prepare(options.app!, context)
        break
      case 'audit:list':
        result = await new AuditQueryService(
          new AdminReadRepository(source, applications)
        ).listGlobal({})
        break
    }
    process.stdout.write(JSON.stringify({ database, result }, null, 2) + '\n')
  } finally {
    if (source.isInitialized) await source.destroy()
  }
}
void main().catch((error: unknown) => {
  const message =
    error instanceof Error && !('query' in error) && !('sql' in error)
      ? error.message
      : 'Database operation failed; verify schema, target database and audit state'
  process.stderr.write(message + '\n')
  process.exitCode = 1
})
