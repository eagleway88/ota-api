import { Table } from "typeorm"

/** 
 * 除了字母（大小写）之外的所有字符替换为下划线 
 * */
export function createTableName(name: string) {
  return name.replace(/[^a-zA-Z]/g, "_")
}

export function createSuccessTable(name: string) {
  const tableName = createTableName(name)
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
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'extras', type: 'json', isNullable: true, comment: '扩展信息' },
      { name: 'username', type: 'varchar', isNullable: true, comment: '用户名' },
      { name: 'create_time', type: 'datetime', isNullable: true }
    ]
  })
}

export function createErrorTable(name: string) {
  const tableName = createTableName(name)
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
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'extras', type: 'json', isNullable: true, comment: '扩展信息' },
      { name: 'message', type: 'text', isNullable: true, comment: '错误信息' },
      { name: 'username', type: 'varchar', isNullable: true, comment: '用户名' },
      { name: 'update_time', type: 'datetime', isNullable: true },
      { name: 'create_time', type: 'datetime', isNullable: true },
    ]
  })
}

export function createAppErrorLogTable(name: string) {
  const tableName = createTableName(name)
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
      { name: 'kind', type: 'varchar', comment: '错误类型(crash=闪退 error=报错)' },
      { name: 'message', type: 'text', isNullable: true, comment: '错误信息' },
      { name: 'stack', type: 'text', isNullable: true, comment: '错误堆栈' },
      { name: 'report_count', type: 'int', comment: '上报次数', default: 1 },
      { name: 'username', type: 'varchar', isNullable: true, comment: '用户名' },
      { name: 'update_time', type: 'datetime', isNullable: true },
      { name: 'create_time', type: 'datetime', isNullable: true },
    ]
  })
}

export function createVersionTable(name: string) {
  const tableName = createTableName(name)
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
      { name: 'name', type: 'varchar', comment: '应用名称' },
      { name: 'ver', type: 'int', comment: '版本号(1.0.0=100)' },
      { name: 'desc', type: 'text', isNullable: true, comment: '更新描述' },
      { name: 'file_size', type: 'int', isNullable: true, comment: '文件大小' },
      { name: 'enable', type: 'tinyint', isNullable: true, comment: '是否启用', default: 1 },
      { name: 'mandatory', type: 'tinyint', isNullable: true, comment: '是否强制更新', default: 1 },
      { name: 'install_url', type: 'varchar', isNullable: true, comment: '安装链接(全量更新时不为null)' },
      { name: 'package_url', type: 'varchar', isNullable: true, comment: '热更新链接(热更新时不为null)' },
      { name: 'update_type', type: 'varchar', isNullable: true, comment: '更新类型(full=全量更新 hot=热更新)' },
      { name: 'channel', type: 'varchar', isNullable: true, comment: '渠道(appstore或其它,用于全量更新下发不同的链接)' },
      { name: 'platform', type: 'varchar', comment: '平台(多平台用逗号拼接ios,android)' },
      { name: 'ip', type: 'varchar', isNullable: true, comment: 'IP' },
      { name: 'create_time', type: 'datetime', isNullable: true },
    ]
  })
}