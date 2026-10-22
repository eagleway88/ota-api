import { QueryRunner } from 'typeorm'

const globals = [
  'ota_installation',
  'ota_applications',
  'ota_audit_log',
  'ota_api_keys',
  'ota_api_key_applications',
  'ota_messages'
]
/** Refuse unrelated databases before any schema DDL; permit retries of our own installation. */
export async function assertInitializableDatabase(
  runner: QueryRunner,
  allowPreparedApplications = false
) {
  const tables = (await runner.query(
    'SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()'
  )) as Array<{ name: string }>
  const existing = tables
    .map(t => t.name)
    .filter(n => n !== 'ota_schema_history')
  if (!existing.length) return
  if (
    !existing.includes('ota_installation') ||
    (!allowPreparedApplications && existing.some(n => !globals.includes(n)))
  )
    throw new Error(
      'A fresh empty database is required; existing data will not be modified'
    )
  const marker = (await runner.query(
    'SELECT schema_id FROM ota_installation'
  )) as Array<{ schema_id: string }>
  if (marker.length !== 1 || marker[0].schema_id !== 'ota-v1')
    throw new Error('Unknown database installation; refusing initialization')
}

export async function assertInstalledDatabase(runner: QueryRunner) {
  for (const table of [
    'ota_installation',
    'ota_schema_history',
    ...globals.filter(t => t !== 'ota_installation')
  ])
    if (!(await runner.hasTable(table)))
      throw new Error(
        'Database is not initialized; run yarn db:init against a fresh database first'
      )
  const marker = (await runner.query(
    'SELECT schema_id FROM ota_installation'
  )) as Array<{ schema_id: string }>
  const history = (await runner.query(
    'SELECT name FROM ota_schema_history WHERE name = ?',
    ['InitialSchema1792713600000']
  )) as Array<{ name: string }>
  if (
    marker.length !== 1 ||
    marker[0].schema_id !== 'ota-v1' ||
    history.length !== 1
  )
    throw new Error(
      'Database is not a supported OTA installation; initialize a fresh database'
    )
}
