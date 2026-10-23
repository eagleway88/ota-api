const { spawnSync } = require('node:child_process')

const socket = process.env.OTA_TEST_MYSQL_SOCKET ?? ''
if (
  !/^\/(?:private\/)?tmp\/ota-test-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
    socket
  )
) {
  process.stderr.write(
    'Set OTA_TEST_MYSQL_SOCKET to an isolated temporary MySQL socket. See test/README.md.\n'
  )
  process.exit(1)
}
const result = spawnSync(
  process.execPath,
  [
    require.resolve('jest/bin/jest'),
    '--runInBand',
    '--watchman=false',
    '--testPathPatterns=[.]mysql[.]spec[.]ts$',
    ...process.argv.slice(2)
  ],
  { stdio: 'inherit', env: process.env }
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
