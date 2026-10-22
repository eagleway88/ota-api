import { Table } from 'typeorm'
import {
  normalizeAdminQuery,
  storedColumn
} from '@/infrastructure/persistence/admin-query'

describe('administrator query bounds', () => {
  it('defaults to a bounded 30-day window and 20 rows', () => {
    const now = new Date('2026-10-20T00:00:00Z')
    const window = normalizeAdminQuery({}, now)
    expect(window).toEqual({
      page: 1,
      pageSize: 20,
      offset: 0,
      from: new Date('2026-09-20T00:00:00Z'),
      to: now
    })
  })

  it.each([
    { page: '0' },
    { page: '1.5' },
    { pageSize: '101' },
    { from: '2026-10-20T00:00:00Z', to: '2026-10-19T00:00:00Z' },
    { from: '2026-01-01T00:00:00Z', to: '2026-10-19T00:00:00Z' },
    { from: 'not-a-date' }
  ])('rejects unbounded or invalid input %j', query => {
    expect(() => normalizeAdminQuery(query)).toThrow()
  })

  it('can query historical periods years ago without a retention cutoff', () => {
    expect(
      normalizeAdminQuery(
        { from: '2020-01-01T00:00:00Z', to: '2020-02-01T00:00:00Z' },
        new Date('2026-10-23T00:00:00Z')
      )
    ).toMatchObject({
      from: new Date('2020-01-01T00:00:00Z'),
      to: new Date('2020-02-01T00:00:00Z')
    })
  })

  it('requires canonical report timestamps without fallback or runtime DDL', () => {
    const table = new Table({
      name: 'app_success',
      columns: [{ name: 'created_at', type: 'datetime' }]
    })
    expect(storedColumn(table, 'report', 'created_at')).toBe(
      'report.`created_at`'
    )
    expect(() => storedColumn(table, 'report', 'missing')).toThrow()
  })
})
