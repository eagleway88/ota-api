import 'reflect-metadata'
import * as dotenv from 'dotenv'
import mysql from 'mysql2/promise'
import type { RowDataPacket } from 'mysql2'

dotenv.config({ path: '.env' })

interface Row extends RowDataPacket {
  [column: string]: unknown
}

function required(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is required`)
  }
  return value
}

async function main() {
  const database = required('ORM_DATABASE')
  const connection = await mysql.createConnection({
    host: required('ORM_HOST'),
    port: Number(process.env.ORM_PORT || 3306),
    user: required('ORM_USERNAME'),
    password: required('ORM_PASSWORD'),
    database
  })

  try {
    const [versionRows] = await connection.query<Row[]>(
      'SELECT VERSION() AS version'
    )
    const [schemaRows] = await connection.execute<Row[]>(
      `SELECT DEFAULT_CHARACTER_SET_NAME AS characterSet,
              DEFAULT_COLLATION_NAME AS collation
       FROM information_schema.SCHEMATA
       WHERE SCHEMA_NAME = ?`,
      [database]
    )
    const [tableRows] = await connection.execute<Row[]>(
      `SELECT TABLE_NAME AS tableName, AUTO_INCREMENT AS autoIncrement,
              TABLE_ROWS AS estimatedRows
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND (TABLE_NAME LIKE '%\\_version' ESCAPE '\\'
           OR TABLE_NAME LIKE '%\\_success' ESCAPE '\\'
           OR TABLE_NAME LIKE '%\\_error' ESCAPE '\\'
           OR TABLE_NAME LIKE '%\\_error_log' ESCAPE '\\')
       ORDER BY TABLE_NAME`,
      [database]
    )

    const versionTables: Row[] = []
    for (const table of tableRows) {
      const tableName = String(table.tableName)
      if (!tableName.endsWith('_version')) {
        continue
      }
      if (!/^[A-Za-z0-9_]+$/.test(tableName)) {
        throw new Error(`Unsafe table name returned by metadata: ${tableName}`)
      }
      const [summaryRows] = await connection.query<Row[]>(
        `SELECT COUNT(*) AS rowCount, MAX(id) AS maximumId,
                COUNT(DISTINCT name) AS distinctApplicationNames
         FROM \`${tableName}\``
      )
      const [applicationRows] = await connection.query<Row[]>(
        `SELECT name, COUNT(*) AS rowCount
         FROM \`${tableName}\`
         GROUP BY name ORDER BY name`
      )
      const [columnRows] = await connection.execute<Row[]>(
        `SELECT COLUMN_NAME AS columnName
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`,
        [database, tableName]
      )
      const columns = new Set(columnRows.map(row => String(row.columnName)))
      const requiredColumns = [
        'release_id',
        'release_scope',
        'policy_revision',
        'target_version_code',
        'compatible_base_version_codes'
      ]
      versionTables.push({
        tableName,
        autoIncrement: table.autoIncrement,
        ...summaryRows[0],
        applications: applicationRows,
        missingRefactorColumns: requiredColumns.filter(
          column => !columns.has(column)
        )
      })
    }

    process.stdout.write(
      `${JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          readOnly: true,
          database,
          mysqlVersion: versionRows[0]?.version,
          schema: schemaRows[0],
          dynamicTables: tableRows,
          versionTables
        },
        null,
        2
      )}\n`
    )
  } finally {
    await connection.end()
  }
}

void main().catch(error => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  )
  process.exitCode = 1
})
