// Test-only transport injection: production CLI supports only the usual host/port.
// Explicitly preloaded by the isolated CLI subprocess suite, never by runtime code.
const mysql = require('mysql2')
const socketPath = process.env.OTA_TEST_MYSQL_SOCKET
if (
  !/^\/(?:private\/)?tmp\/ota-test-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
    socketPath || ''
  ) ||
  !/^ota_test_[0-9a-f]{32}$/.test(process.env.ORM_DATABASE || '')
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
