const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const output = path.resolve(__dirname, '../dist')
for (const file of [
  'main.js',
  'app.js',
  'app/updates/update-check.controller.js',
  'infrastructure/persistence/application-schema.js',
  'auth/api-key.service.js'
]) {
  assert.ok(
    fs.existsSync(path.join(output, file)),
    `Build entry is missing: ${file}`
  )
}
for (const file of fs.readdirSync(output, { recursive: true })) {
  assert.ok(
    !/(^|[/\\])(test|fixtures|scripts)([/\\]|$)|\.spec\./.test(file),
    `Non-runtime file was compiled into deployment output: ${file}`
  )
}
process.stdout.write(
  'Deployment entries verified; tests, fixtures and operational CLIs excluded.\n'
)
