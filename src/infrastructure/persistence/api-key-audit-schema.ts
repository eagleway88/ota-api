import { QueryRunner, TableColumn, TableIndex } from 'typeorm'

/** Called only by migrations or explicit CLI preparation, never by HTTP requests. */
export async function ensureApiKeyAuditSchema(
  runner: QueryRunner,
  table: string,
  index: string
) {
  if (!(await runner.hasColumn(table, 'actor_key_id'))) {
    await runner.addColumn(
      table,
      new TableColumn({
        name: 'actor_key_id',
        type: 'varchar',
        length: '36',
        isNullable: true
      })
    )
  }
  if (
    !(await runner.getTable(table))?.indices.some(item => item.name === index)
  ) {
    await runner.createIndex(
      table,
      new TableIndex({
        name: index,
        columnNames: ['actor_key_id', 'created_at']
      })
    )
  }
}
