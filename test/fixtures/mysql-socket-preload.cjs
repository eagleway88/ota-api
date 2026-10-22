// Test-only transport injection: production CLI supports only the usual host/port.
// Explicitly preloaded by the isolated CLI subprocess suite, never by runtime code.
const mysql = require('mysql2')
const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
if (
  !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
    socketPath || ''
  ) ||
  !/^ota_migration_test_[0-9a-f]{32}$/.test(process.env.ORM_DATABASE || '')
) {
  throw new Error(
    'The test preloader requires an isolated socket and generated test database'
  )
}
const createPool = mysql.createPool
const withSocket = options => {
  if (!options || options.database !== process.env.ORM_DATABASE) {
    throw new Error('Refusing a connection outside the generated test database')
  }
  return { ...options, socketPath }
}
mysql.createPool = options => createPool(withSocket(options))

// The read-only audit CLI uses the promise driver rather than a TypeORM pool.
const promiseDriver = require('mysql2/promise')
const createConnection = promiseDriver.createConnection
promiseDriver.createConnection = async options => {
  const connection = await createConnection(withSocket(options))
  try {
    const mode = process.env.OTA_MIGRATION_TEST_SQL_MODE
    if (mode !== undefined) {
      if (
        ![
          '',
          'NO_BACKSLASH_ESCAPES',
          'ANSI_QUOTES,NO_BACKSLASH_ESCAPES'
        ].includes(mode)
      ) {
        throw new Error('Unsupported test SQL mode')
      }
      await connection.execute('SET SESSION sql_mode = ?', [mode])
    }
    return connection
  } catch (error) {
    await connection.end()
    throw error
  }
}
