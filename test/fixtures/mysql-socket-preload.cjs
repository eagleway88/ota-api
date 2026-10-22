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
mysql.createPool = options => {
  if (!options || options.database !== process.env.ORM_DATABASE) {
    throw new Error('Refusing a connection outside the generated test database')
  }
  return createPool({ ...options, socketPath })
}
