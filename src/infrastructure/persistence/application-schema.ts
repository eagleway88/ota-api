import { Table, TableColumnOptions, TableIndexOptions } from 'typeorm'
type TableSource = { tablePrefix: string }
const col = (
  name: string,
  type: string,
  extra: Partial<TableColumnOptions> = {}
): TableColumnOptions => ({
  name,
  type,
  ...(type === 'varchar' ? { collation: 'utf8mb4_bin' } : {}),
  ...extra
})
const id = (name = 'id') =>
  col(name, 'int', {
    isPrimary: true,
    isGenerated: true,
    generationStrategy: 'increment'
  })
const text = (name: string, length = '191') =>
  col(name, 'varchar', { length, isNullable: true })
const json = (name: string) => col(name, 'json', { isNullable: true })
const date = (name: string) => col(name, 'datetime', { precision: 3 })
function table(
  source: TableSource,
  suffix: string,
  columns: TableColumnOptions[],
  indices: TableIndexOptions[] = []
) {
  if (!/^[A-Za-z0-9_]{1,40}$/.test(source.tablePrefix))
    throw new Error('Invalid registered table prefix')
  return new Table({
    name: source.tablePrefix + '_' + suffix,
    engine: 'InnoDB',
    columns,
    indices
  })
}
export function createReleaseTable(source: TableSource) {
  return table(
    source,
    'release',
    [
      id('release_sequence'),
      col('app_name', 'varchar', { length: '128' }),
      col('release_id', 'varchar', { length: '36', isUnique: true }),
      col('release_scope', 'varchar', { length: '16' }),
      col('policy_revision', 'int', { default: 1 }),
      col('target_version_code', 'int'),
      col('base_version_codes', 'json'),
      col('platforms', 'json'),
      col('architectures', 'json'),
      text('distribution_channel', '128'),
      col('update_type', 'varchar', { length: '8' }),
      col('release_notes', 'text', { isNullable: true }),
      col('artifact_size_bytes', 'bigint', { isNullable: true }),
      text('installer_source_url', '2048'),
      text('bundle_url', '2048'),
      col('is_enabled', 'tinyint'),
      col('is_mandatory', 'tinyint'),
      col('show_update_dialog', 'tinyint'),
      text('source_ip', '64'),
      date('created_at'),
      date('updated_at')
    ],
    [{ columnNames: ['created_at', 'release_sequence'] }]
  )
}
function reportColumns() {
  return [
    id(),
    col('app_name', 'varchar', { length: '128' }),
    col('platform', 'varchar', { length: '16' }),
    col('version_code', 'int'),
    text('reported_username'),
    json('extras'),
    text('source_ip', '64'),
    date('created_at')
  ]
}
export function createSuccessTable(source: TableSource) {
  return table(
    source,
    'success',
    [
      ...reportColumns(),
      col('release_sequence', 'int'),
      col('report_id', 'varchar', {
        length: '36',
        isNullable: true,
        isUnique: true
      })
    ],
    [
      { columnNames: ['created_at', 'id'] },
      { columnNames: ['release_sequence', 'created_at'] }
    ]
  )
}
export function createErrorTable(source: TableSource) {
  return table(
    source,
    'error',
    [
      ...reportColumns(),
      col('release_sequence', 'int'),
      col('report_id', 'varchar', {
        length: '36',
        isNullable: true,
        isUnique: true
      }),
      col('message', 'text'),
      date('updated_at')
    ],
    [
      { columnNames: ['created_at', 'id'] },
      { columnNames: ['release_sequence', 'created_at'] }
    ]
  )
}
export function createAppErrorLogTable(source: TableSource) {
  return table(
    source,
    'error_log',
    [
      ...reportColumns(),
      col('kind', 'varchar', { length: '64' }),
      col('message', 'text'),
      col('stack', 'text', { isNullable: true }),
      col('error_hash', 'varchar', { length: '64', isUnique: true }),
      col('report_count', 'bigint', { default: 1 }),
      date('updated_at')
    ],
    [{ columnNames: ['updated_at', 'id'] }]
  )
}
