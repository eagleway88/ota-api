import {
  VERSION_TABLE_AUTO_INCREMENT_START,
  calculateNextReleaseSequence,
  createErrorTable,
  createSuccessTable
} from './version'

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
