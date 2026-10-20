import { Table, TableIndex } from 'typeorm'

export const VERSION_TABLE_AUTO_INCREMENT_START = 2000

export function calculateNextReleaseSequence(
  currentAutoIncrement?: number | null,
  maximumStoredId?: number | null,
  maximumConfirmedIssuedId?: number | null
) {
  return Math.max(
    VERSION_TABLE_AUTO_INCREMENT_START,
    Number(currentAutoIncrement) || 0,
    (Number(maximumStoredId) || 0) + 1,
    (Number(maximumConfirmedIssuedId) || 0) + 1
  )
}

function normalizeVersionToken(value: string | number) {
  const normalized = String(value).trim().replaceAll('.', '')
  if (!normalized) {
    return undefined
  }

  return /^\d+$/.test(normalized) ? normalized : undefined
}

export function normalizeVersionValue(value?: string | number | null) {
  if (value === undefined || value === null) {
    return undefined
  }

  const normalized = normalizeVersionToken(value)
  if (!normalized) {
    return undefined
  }

  return Number(normalized)
}

export function normalizeVersionList(value?: string | null) {
  if (!value) {
    return undefined
  }

  const normalizedList = Array.from(
    new Set(
      value
        .split(',')
        .map(item => normalizeVersionToken(item))
        .filter((item): item is string => !!item)
    )
  )

  if (!normalizedList.length) {
    return undefined
  }

  return normalizedList.join(',')
}

/**
 * 除了字母（大小写）之外的所有字符替换为下划线
 * */
export function createTableName(name: string) {
  return name.replace(/[^a-zA-Z]/g, '_')
}

/** Strings are legacy application names; objects are already registered prefixes. */
type TableSource = string | { tablePrefix: string }

function schemaPrefix(source: TableSource) {
  if (typeof source === 'string') return createTableName(source)
  if (!/^[A-Za-z0-9_]{1,40}$/.test(source.tablePrefix)) {
    throw new Error('Invalid registered table prefix')
  }
  return source.tablePrefix
}

export function createSuccessTable(name: TableSource) {
  const tableName = schemaPrefix(name)
  return new Table({
    name: `${tableName}_success`,
    columns: [
      {
        name: 'id',
        type: 'int',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment'
      },
      { name: 'name', type: 'varchar', comment: '应用名称' },
      { name: 'platform', type: 'varchar', comment: '平台' },
      { name: 'ver', type: 'int', comment: '版本号(1.0.0=100)' },
      { name: 'ver_id', type: 'int', comment: 'tableName_version表id' },
      {
        name: 'release_sequence',
        type: 'int',
        isNullable: true,
        comment: '正式发布序号'
      },
      {
        name: 'report_id',
        type: 'varchar',
        length: '36',
        isNullable: true,
        isUnique: true,
        comment: '可选幂等上报ID'
      },
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'extras', type: 'json', isNullable: true, comment: '扩展信息' },
      {
        name: 'username',
        type: 'varchar',
        isNullable: true,
        comment: '用户名'
      },
      {
        name: 'reported_username',
        type: 'varchar',
        isNullable: true,
        comment: '正式上报展示用户名'
      },
      { name: 'create_time', type: 'datetime', isNullable: true },
      { name: 'created_at', type: 'datetime', isNullable: true }
    ]
  })
}

export function createErrorTable(name: TableSource) {
  const tableName = schemaPrefix(name)
  return new Table({
    name: `${tableName}_error`,
    columns: [
      {
        name: 'id',
        type: 'int',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment'
      },
      { name: 'name', type: 'varchar', comment: '应用名称' },
      { name: 'platform', type: 'varchar', comment: '平台' },
      { name: 'ver', type: 'int', comment: '版本号(1.0.0=100)' },
      { name: 'ver_id', type: 'int', comment: 'tableName_version表id' },
      {
        name: 'release_sequence',
        type: 'int',
        isNullable: true,
        comment: '正式发布序号'
      },
      {
        name: 'report_id',
        type: 'varchar',
        length: '36',
        isNullable: true,
        isUnique: true,
        comment: '可选幂等上报ID'
      },
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'extras', type: 'json', isNullable: true, comment: '扩展信息' },
      { name: 'message', type: 'text', isNullable: true, comment: '错误信息' },
      {
        name: 'username',
        type: 'varchar',
        isNullable: true,
        comment: '用户名'
      },
      {
        name: 'reported_username',
        type: 'varchar',
        isNullable: true,
        comment: '正式上报展示用户名'
      },
      { name: 'update_time', type: 'datetime', isNullable: true },
      { name: 'create_time', type: 'datetime', isNullable: true },
      { name: 'updated_at', type: 'datetime', isNullable: true },
      { name: 'created_at', type: 'datetime', isNullable: true }
    ]
  })
}

export function createAppErrorLogTable(name: TableSource) {
  const tableName = schemaPrefix(name)
  return new Table({
    name: `${tableName}_error_log`,
    columns: [
      {
        name: 'id',
        type: 'int',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment'
      },
      { name: 'name', type: 'varchar', comment: '应用名称' },
      { name: 'platform', type: 'varchar', comment: '平台' },
      { name: 'ver', type: 'int', comment: '版本号(1.0.0=100)' },
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'extras', type: 'json', isNullable: true, comment: '扩展信息' },
      { name: 'error_hash', type: 'varchar', comment: '错误指纹' },
      {
        name: 'kind',
        type: 'varchar',
        comment: '错误类型(crash=闪退 error=报错)'
      },
      { name: 'message', type: 'text', isNullable: true, comment: '错误信息' },
      { name: 'stack', type: 'text', isNullable: true, comment: '错误堆栈' },
      { name: 'report_count', type: 'int', comment: '上报次数', default: 1 },
      {
        name: 'username',
        type: 'varchar',
        isNullable: true,
        comment: '用户名'
      },
      {
        name: 'reported_username',
        type: 'varchar',
        isNullable: true,
        comment: '正式上报展示用户名'
      },
      { name: 'update_time', type: 'datetime', isNullable: true },
      { name: 'create_time', type: 'datetime', isNullable: true },
      { name: 'updated_at', type: 'datetime', isNullable: true },
      { name: 'created_at', type: 'datetime', isNullable: true }
    ]
  })
}

export function createVersionTable(name: TableSource) {
  const tableName = schemaPrefix(name)
  return new Table({
    name: `${tableName}_version`,
    columns: [
      {
        name: 'id',
        type: 'int',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment'
      },
      {
        name: 'release_id',
        type: 'varchar',
        length: '36',
        isNullable: true,
        isUnique: true,
        comment: '内部版本UUID'
      },
      {
        name: 'release_scope',
        type: 'varchar',
        length: '16',
        default: "'public'",
        comment: '发布范围(public/allowlist)'
      },
      {
        name: 'policy_revision',
        type: 'int',
        default: 1,
        comment: '发布策略修订号'
      },
      {
        name: 'target_version_code',
        type: 'int',
        isNullable: true,
        comment: '目标版本编码'
      },
      {
        name: 'compatible_base_version_codes',
        type: 'json',
        isNullable: true,
        comment: '明确兼容的原生基础版本编码'
      },
      {
        name: 'release_notes',
        type: 'text',
        isNullable: true,
        comment: '发布说明'
      },
      {
        name: 'artifact_size_bytes',
        type: 'bigint',
        isNullable: true,
        comment: '更新资源字节数'
      },
      {
        name: 'is_enabled',
        type: 'tinyint',
        isNullable: true,
        comment: '正式启用标记'
      },
      {
        name: 'is_mandatory',
        type: 'tinyint',
        isNullable: true,
        comment: '正式强制更新标记'
      },
      {
        name: 'show_update_dialog',
        type: 'tinyint',
        isNullable: true,
        comment: '正式更新弹窗标记'
      },
      {
        name: 'installer_source_url',
        type: 'varchar',
        length: '2048',
        isNullable: true,
        comment: '安装文件或更新源目录'
      },
      {
        name: 'bundle_url',
        type: 'varchar',
        length: '2048',
        isNullable: true,
        comment: '热更新包地址'
      },
      {
        name: 'platforms',
        type: 'json',
        isNullable: true,
        comment: '正式平台列表'
      },
      {
        name: 'architectures',
        type: 'json',
        isNullable: true,
        comment: '正式架构列表'
      },
      {
        name: 'distribution_channel',
        type: 'varchar',
        isNullable: true,
        comment: '正式分发渠道'
      },
      {
        name: 'created_at',
        type: 'datetime',
        isNullable: true
      },
      {
        name: 'updated_at',
        type: 'datetime',
        isNullable: true
      },
      { name: 'name', type: 'varchar', comment: '应用名称' },
      { name: 'ver', type: 'int', comment: '版本号(1.0.0=100)' },
      {
        name: 'base_versions',
        type: 'varchar',
        isNullable: true,
        comment: '适用基础版本(多版本用逗号拼接100,101)'
      },
      { name: 'desc', type: 'text', isNullable: true, comment: '更新描述' },
      { name: 'file_size', type: 'int', isNullable: true, comment: '文件大小' },
      {
        name: 'enable',
        type: 'tinyint',
        isNullable: true,
        comment: '是否启用',
        default: 1
      },
      {
        name: 'mandatory',
        type: 'tinyint',
        isNullable: true,
        comment: '是否强制更新',
        default: 1
      },
      {
        name: 'show_dialog',
        type: 'tinyint',
        isNullable: true,
        comment: '是否显示弹窗',
        default: 1
      },
      {
        name: 'install_url',
        type: 'varchar',
        isNullable: true,
        comment: '安装链接(全量更新时不为null)'
      },
      {
        name: 'package_url',
        type: 'varchar',
        isNullable: true,
        comment: '热更新链接(热更新时不为null)'
      },
      {
        name: 'update_type',
        type: 'varchar',
        isNullable: true,
        comment: '更新类型(full=全量更新 hot=热更新)'
      },
      {
        name: 'channel',
        type: 'varchar',
        isNullable: true,
        comment: '渠道(appstore或其它,用于全量更新下发不同的链接)'
      },
      {
        name: 'platform',
        type: 'varchar',
        comment: '平台(多平台用逗号拼接ios,android)'
      },
      {
        name: 'architecture',
        type: 'varchar',
        isNullable: true,
        comment: '架构(多架构用逗号拼接arm64,x64)'
      },
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'create_time', type: 'datetime', isNullable: true }
    ]
  })
}

export function createReleaseUserTable(name: TableSource) {
  const tableName = schemaPrefix(name)
  return new Table({
    name: `${tableName}_release_user`,
    columns: [
      {
        name: 'id',
        type: 'bigint',
        isPrimary: true,
        isGenerated: true,
        generationStrategy: 'increment'
      },
      { name: 'release_id', type: 'varchar', length: '36' },
      { name: 'user_id', type: 'varchar', length: '191' },
      { name: 'created_at', type: 'datetime' }
    ],
    indices: [
      new TableIndex({
        name: `${tableName}_release_user_release_user_uq`,
        columnNames: ['release_id', 'user_id'],
        isUnique: true
      }),
      new TableIndex({
        name: `${tableName}_release_user_user_release_idx`,
        columnNames: ['user_id', 'release_id']
      })
    ]
  })
}
