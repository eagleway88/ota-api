import {
  createReleaseTable,
  createSuccessTable,
  createErrorTable,
  createAppErrorLogTable
} from '@/infrastructure/persistence/application-schema'
describe('canonical table definitions', () => {
  it.each([
    [createReleaseTable, 'release'],
    [createSuccessTable, 'success'],
    [createErrorTable, 'error'],
    [createAppErrorLogTable, 'error_log']
  ] as const)('preserves registered prefixes in %s', (factory, suffix) => {
    expect(factory({ tablePrefix: 'app_123' }).name).toBe('app_123_' + suffix)
    expect(() => factory({ tablePrefix: 'unsafe;DROP' })).toThrow()
    expect(() => factory({ tablePrefix: 'a'.repeat(41) })).toThrow()
  })
  it('uses an explicit release sequence and required publication fields', () => {
    const schema = createReleaseTable({ tablePrefix: 'app' })
    expect(schema.primaryColumns.map(c => c.name)).toEqual(['release_sequence'])
    expect(schema.columns.map(c => c.name)).toEqual([
      'release_sequence',
      'app_name',
      'release_id',
      'release_scope',
      'policy_revision',
      'target_version_code',
      'base_version_codes',
      'platforms',
      'architectures',
      'distribution_channel',
      'update_type',
      'release_notes',
      'artifact_size_bytes',
      'installer_source_url',
      'bundle_url',
      'is_enabled',
      'is_mandatory',
      'show_update_dialog',
      'source_ip',
      'created_at',
      'updated_at'
    ])
  })
})
