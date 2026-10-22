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

  it('reads legacy and dual-written report timestamps without runtime DDL', () => {
    const table = new Table({
      name: 'app_success',
      columns: [{ name: 'create_time', type: 'datetime' }]
    })
    expect(storedColumn(table, 'report', 'created_at', 'create_time')).toBe(
      'report.`create_time`'
    )
    expect(() => storedColumn(table, 'report', 'missing')).toThrow()
  })
})
