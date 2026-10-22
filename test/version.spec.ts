import {
  createVersionTable,
  createSuccessTable,
  createErrorTable,
  createAppErrorLogTable
} from '@/infrastructure/persistence/application-schema'
describe('canonical table definitions', () => {
  it.each([
    [createVersionTable, 'version'],
    [createSuccessTable, 'success'],
    [createErrorTable, 'error'],
    [createAppErrorLogTable, 'error_log']
  ] as const)('preserves registered prefixes in %s', (factory, suffix) => {
    expect(factory({ tablePrefix: 'app_123' }).name).toBe('app_123_' + suffix)
    expect(() => factory({ tablePrefix: 'unsafe;DROP' })).toThrow()
    expect(() => factory({ tablePrefix: 'a'.repeat(41) })).toThrow()
  })
  it('contains no old release/report aliases', () => {
    for (const factory of [
      createVersionTable,
      createSuccessTable,
      createErrorTable,
      createAppErrorLogTable
    ]) {
      const columns = factory({ tablePrefix: 'app' }).columns.map(c => c.name)
      expect(columns).toContain('app_name')
      expect(columns).toContain('created_at')
      for (const old of [
        'name',
        'ver',
        'ver_id',
        'base_versions',
        'platforms_csv',
        'create_time',
        'username',
        'ip',
        'enable',
        'mandatory'
      ])
        expect(columns).not.toContain(old)
    }
  })
})
