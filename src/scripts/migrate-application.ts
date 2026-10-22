import 'reflect-metadata'
import * as dotenv from 'dotenv'
import { DataSource } from 'typeorm'
import {
  ApplicationDataMigrator,
  MigrationBlockedError
} from '@/infrastructure/migrations/application-data-migrator'
import {
  migrationHelp,
  parseMigrationArguments
} from '@/infrastructure/migrations/migration-cli-options'

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write(`${migrationHelp}\n`)
    return
  }
  // Parse and enforce all write confirmations before loading credentials/connecting.
  const { options, database, envFile } = parseMigrationArguments(args)
  dotenv.config({ path: envFile, quiet: true })
  const required = (name: string) => {
    if (!process.env[name]) throw new Error(`Missing configuration: ${name}`)
    return process.env[name]
  }
  const configuredDatabase = required('ORM_DATABASE')
  if (database && database !== configuredDatabase)
    throw new Error('Confirmed database does not match configuration')
  const source = new DataSource({
    type: 'mysql',
    host: required('ORM_HOST'),
    port: Number(process.env.ORM_PORT ?? 3306),
    username: required('ORM_USERNAME'),
    password: required('ORM_PASSWORD'),
    database: configuredDatabase,
    synchronize: false,
    logging: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  })
  try {
    await source.initialize()
    const result = await new ApplicationDataMigrator(source).run(options)
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (['blocked', 'incomplete'].includes(result.status)) process.exitCode = 2
    if (result.status === 'paused') process.exitCode = 3
  } finally {
    if (source.isInitialized) await source.destroy()
  }
}

void main().catch((error: unknown) => {
  if (error instanceof MigrationBlockedError) {
    process.stderr.write(
      `${JSON.stringify({ error: error.message, plan: error.plan })}\n`
    )
    process.exitCode = 2
  } else {
    // Do not print driver SQL/parameters, which may contain historical private data.
    const message =
      error instanceof Error && !('query' in error) && !('sql' in error)
        ? error.message
        : 'Database operation failed; inspect the migration checkpoint'
    process.stderr.write(`${message}\n`)
    process.exitCode = 1
  }
})
