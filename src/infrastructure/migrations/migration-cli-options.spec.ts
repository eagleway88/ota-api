import { parseMigrationArguments } from './migration-cli-options'

const identity = ['--app', 'app', '--table-prefix', 'app_123a']
describe('migration CLI safety', () => {
  it('defaults to a bounded read-only dry run', () => {
    expect(parseMigrationArguments(identity).options).toMatchObject({
      mode: 'dry-run',
      batchSize: 200,
      activateFormal: false
    })
  })
  it.each([
    ['--apply'],
    [
      '--apply',
      '--database',
      'test',
      '--issued-id',
      '3000',
      '--confirm-backup'
    ],
    [
      '--apply',
      '--issued-id',
      '3000',
      '--confirm-backup',
      '--confirm-writes-paused'
    ],
    ['--apply', '--verify'],
    ['--batch-size', '1001'],
    ['--issued-id', '-1'],
    ['--activate-formal'],
    ['--unknown'],
    ['--app', 'another'],
    ['--max-batches', '0']
  ])('rejects unsafe/ambiguous options before connecting: %j', (...args) => {
    expect(() => parseMigrationArguments([...identity, ...args])).toThrow()
  })
  it('requires explicit target and operational confirmations to apply', () => {
    const parsed = parseMigrationArguments([
      ...identity,
      '--apply',
      '--database',
      'test',
      '--issued-id',
      '3000',
      '--confirm-backup',
      '--confirm-writes-paused',
      '--activate-formal'
    ])
    expect(parsed.options).toMatchObject({
      mode: 'apply',
      confirmedIssuedId: 3000,
      activateFormal: true
    })
    expect(parsed.database).toBe('test')
  })
})
