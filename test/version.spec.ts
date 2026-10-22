import {
  VERSION_TABLE_AUTO_INCREMENT_START,
  calculateNextReleaseSequence,
  createVersionTable,
  createReleaseUserTable,
  createAppErrorLogTable,
  createErrorTable,
  createSuccessTable
} from '@/utils/version'

describe('registered physical table prefixes', () => {
  it.each([
    [createVersionTable, 'version'],
    [createSuccessTable, 'success'],
    [createErrorTable, 'error'],
    [createAppErrorLogTable, 'error_log'],
    [createReleaseUserTable, 'release_user']
  ] as const)(
    'preserves digits in registered prefixes: %s',
    (factory, suffix) => {
      expect(factory({ tablePrefix: 'app_1a2b' }).name).toBe(
        `app_1a2b_${suffix}`
      )
      expect(factory('app-123').name).toBe(`app_____` + suffix)
      expect(() => factory({ tablePrefix: 'app`;DROP TABLE x' })).toThrow(
        'Invalid registered table prefix'
      )
      expect(() => factory({ tablePrefix: 'a'.repeat(41) })).toThrow(
        'Invalid registered table prefix'
      )
    }
  )

  it('uses the exact registered prefix in audience indexes too', () => {
    expect(
      createReleaseUserTable({ tablePrefix: 'app_1a2b' }).indices.map(
        index => index.name
      )
    ).toEqual([
      'app_1a2b_release_user_release_user_uq',
      'app_1a2b_release_user_user_release_idx'
    ])
  })
})

describe('release sequence floor', () => {
  it('starts new and low-watermark applications at 2000', () => {
    expect(VERSION_TABLE_AUTO_INCREMENT_START).toBe(2000)
    expect(calculateNextReleaseSequence(undefined, undefined)).toBe(2000)
    expect(calculateNextReleaseSequence(1381, 1380)).toBe(2000)
  })

  it('continues above existing records and preserves a higher watermark', () => {
    expect(calculateNextReleaseSequence(2351, 2350)).toBe(2351)
    expect(calculateNextReleaseSequence(3000, 1200)).toBe(3000)
  })
})

describe('telemetry table compatibility', () => {
  it('keeps legacy columns while adding formal report fields', () => {
    for (const table of [createSuccessTable('app'), createErrorTable('app')]) {
      const columns = table.columns.map(column => column.name)
      expect(columns).toEqual(
        expect.arrayContaining([
          'ver_id',
          'username',
          'release_sequence',
          'reported_username',
          'report_id',
          'created_at'
        ])
      )
    }
  })
})
