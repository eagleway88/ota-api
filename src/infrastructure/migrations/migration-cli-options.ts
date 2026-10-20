import { MigrationOptions } from './application-migration-contract'
import { validateMigrationOptions } from './application-data-migrator'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

export function parseMigrationArguments(args: string[]) {
  const switches = new Set([
    'dry-run',
    'verify',
    'apply',
    'confirm-backup',
    'confirm-writes-paused',
    'activate-formal'
  ])
  const values = new Set([
    'app',
    'table-prefix',
    'batch-size',
    'max-batches',
    'issued-id',
    'database',
    'env-file'
  ])
  const parsed = new Map<string, string | true>()
  for (let i = 0; i < args.length; i++) {
    const key = args[i].startsWith('--') ? args[i].slice(2) : ''
    if (!switches.has(key) && !values.has(key))
      throw new Error(`Unknown option: ${args[i]}`)
    if (parsed.has(key)) throw new Error(`Duplicate option: --${key}`)
    if (switches.has(key)) parsed.set(key, true)
    else {
      const value = args[++i]
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value: --${key}`)
      parsed.set(key, value)
    }
  }
  if (['dry-run', 'verify', 'apply'].filter(key => parsed.has(key)).length > 1)
    throw new Error('Choose only one migration mode')
  const numeric = (key: string, fallback?: number) => {
    const value = parsed.get(key)
    if (value === undefined) return fallback
    if (typeof value !== 'string' || !/^\d+$/.test(value))
      throw new Error(`Invalid integer: --${key}`)
    return Number(value)
  }
  const options: MigrationOptions = {
    appName: String(parsed.get('app') ?? ''),
    tablePrefix: String(parsed.get('table-prefix') ?? ''),
    mode: parsed.has('apply')
      ? 'apply'
      : parsed.has('verify')
        ? 'verify'
        : 'dry-run',
    batchSize: numeric('batch-size', 200)!,
    maximumBatches: numeric('max-batches'),
    confirmedIssuedId: numeric('issued-id'),
    confirmBackup: parsed.has('confirm-backup'),
    confirmWritesPaused: parsed.has('confirm-writes-paused'),
    activateFormal: parsed.has('activate-formal')
  }
  new ApplicationTableResolver().resolve(options.appName, options.tablePrefix)
  validateMigrationOptions(options)
  const database = parsed.get('database') as string | undefined
  if (options.mode === 'apply' && !database)
    throw new Error('apply requires --database to confirm the target database')
  return {
    options,
    database,
    envFile: String(parsed.get('env-file') ?? '.env')
  }
}

export const migrationHelp = `Usage: yarn migrate:app --app NAME --table-prefix CONFIRMED_PREFIX [options]
Default mode: --dry-run (read-only). --verify performs read-only reconciliation.
--apply --database DB --issued-id N --confirm-backup --confirm-writes-paused
  Apply resumable batches. Register/prepare the confirmed mapping and run global migrations first.
--batch-size N       1–1000, default 200
--max-batches N      Stop with a durable checkpoint after N nonempty batches
--activate-formal    Switch this application only after successful apply + verification
--env-file PATH      Configuration file, default .env
No old columns, historical IDs, or event records are deleted or renumbered.`
