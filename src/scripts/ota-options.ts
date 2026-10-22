import {
  isApiKeyPreset,
  ApiKeyPreset,
  validApiKeyName
} from '@/auth/api-key.policy'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { keyIdPattern } from '@/auth/api-key.service'

export type OtaCommand = {
  command:
    | 'key:create'
    | 'key:list'
    | 'key:inspect'
    | 'key:revoke'
    | 'app:prepare'
    | 'audit:list'
  envFile: string
  database?: string
  app?: string
  applications?: string[]
  name?: string
  preset?: ApiKeyPreset
  prepareApplications?: boolean
  expiresAt?: Date | null
  keyId?: string
}
export function parseOtaArguments(args: string[]): OtaCommand {
  const command = `${args[0]}:${args[1]}` as OtaCommand['command']
  const allowed: Record<OtaCommand['command'], string[]> = {
    'key:create': [
      'apps',
      'name',
      'preset',
      'no-expiry',
      'expires-at',
      'prepare-apps'
    ],
    'key:list': ['app'],
    'key:inspect': ['id'],
    'key:revoke': ['id'],
    'app:prepare': ['app'],
    'audit:list': []
  }
  if (!Object.hasOwn(allowed, command))
    throw new Error('Unknown command; use yarn ota --help')
  const values = new Map<string, string | true>()
  for (let i = 2; i < args.length; i++) {
    const option = args[i].startsWith('--') ? args[i].slice(2) : ''
    if (![...allowed[command], 'env-file', 'database'].includes(option))
      throw new Error('Unknown command option')
    if (values.has(option)) throw new Error(`Duplicate option: --${option}`)
    if (option === 'no-expiry' || option === 'prepare-apps')
      values.set(option, true)
    else {
      const value = args[++i]
      if (!value || value.startsWith('--'))
        throw new Error(`Missing value: --${option}`)
      values.set(option, value)
    }
  }
  const get = (key: string) => values.get(key) as string | undefined
  const required = (key: string) => {
    const v = get(key)
    if (!v) throw new Error(`Required option: --${key}`)
    return v
  }
  const database = get('database')
  if (['key:create', 'key:revoke', 'app:prepare'].includes(command))
    required('database')
  const result: OtaCommand = {
    command,
    envFile: get('env-file') ?? '.env',
    database
  }
  if (command === 'key:create') {
    const apps = required('apps').split(',')
    if (apps.length > 100 || new Set(apps).size !== apps.length)
      throw new Error('Grant 1–100 distinct application names')
    for (const app of apps) new ApplicationTableResolver().validateAppName(app)
    const preset = required('preset')
    if (!isApiKeyPreset(preset))
      throw new Error('Preset must be publisher, observer, messenger or full')
    const name = required('name')
    if (!validApiKeyName(name)) throw new Error('Invalid key name')
    if (values.has('no-expiry') === values.has('expires-at'))
      throw new Error('Choose --no-expiry or --expires-at')
    const expiry = get('expires-at')
    if (
      expiry &&
      (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(expiry) ||
        !Number.isFinite(Date.parse(expiry)) ||
        new Date(expiry).toISOString() !==
          (expiry.includes('.') ? expiry : expiry.slice(0, -1) + '.000Z') ||
        Date.parse(expiry) <= Date.now())
    )
      throw new Error('Expiry must be a future UTC ISO timestamp')
    Object.assign(result, {
      applications: apps,
      name,
      preset,
      expiresAt: expiry ? new Date(expiry) : null,
      prepareApplications: values.has('prepare-apps')
    })
  }
  if (values.has('app')) {
    result.app = get('app')
    new ApplicationTableResolver().validateAppName(result.app!)
  }
  if (command === 'app:prepare') required('app')
  if (command === 'key:inspect' || command === 'key:revoke') {
    result.keyId = required('id')
    if (!keyIdPattern.test(result.keyId)) throw new Error('Invalid key ID')
  }
  return result
}
export const otaHelp = `Usage: yarn ota <command> [options]
key create --apps app-a,app-b --name LABEL --preset publisher|observer|messenger|full [--prepare-apps]
           (--no-expiry | --expires-at UTC_ISO_DATE) --database CONFIRMED_DATABASE
key list [--app APP]
key inspect --id KEY_ID
key revoke --id KEY_ID --database CONFIRMED_DATABASE
app prepare --app APP --database CONFIRMED_DATABASE
audit list
All commands accept --env-file PATH (default .env). Mutations require a matching --database.
Only key create displays accessKey, once. Never place it in arguments or logs.
full covers explicitly granted applications, not wildcard access or platform administration.
Run global migrations first. No HTTP, OSS or background workers are started.`
