import { BadRequestException, ConflictException } from '@nestjs/common'
import { ObjectLiteral, SelectQueryBuilder, Table } from 'typeorm'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'

const DAY_MS = 24 * 60 * 60 * 1000

export function normalizeAdminQuery(
  query: AdminTimeQueryDto,
  now = new Date()
) {
  const page = Number(query.page ?? 1)
  const pageSize = Number(query.pageSize ?? 20)
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 999999 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  ) {
    throw new BadRequestException(
      'page must be 1–999999 and pageSize must be 1–100'
    )
  }
  const to = query.to ? new Date(query.to) : now
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - 30 * DAY_MS)
  const duration = to.getTime() - from.getTime()
  if (!Number.isFinite(duration) || duration <= 0 || duration > 90 * DAY_MS) {
    throw new BadRequestException(
      'Time range must be positive and no longer than 90 days'
    )
  }
  return { page, pageSize, offset: (page - 1) * pageSize, from, to }
}

export type AdminQueryWindow = ReturnType<typeof normalizeAdminQuery>

export function adminPage<T>(
  rows: T[],
  total: number,
  window: AdminQueryWindow,
  extra: Record<string, unknown> = {}
) {
  return {
    code: 0,
    data: {
      data: rows,
      total,
      page: window.page,
      pageSize: window.pageSize,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      ...extra
    }
  }
}

export async function queryAdminPage<T extends ObjectLiteral>(
  filter: SelectQueryBuilder<T>,
  alias: string,
  orderColumn: string,
  idColumn: string,
  window: AdminQueryWindow,
  extraSelects: readonly { expression: string; alias: string }[] = []
) {
  const count = await filter
    .clone()
    .select('COUNT(*)', 'total')
    .getRawOne<{ total: string | number }>()
  const page = filter
    .clone()
    .select(`${alias}.*`)
    .orderBy(orderColumn, 'DESC')
    .addOrderBy(idColumn, 'DESC')
    .offset(window.offset)
    .limit(window.pageSize)
  // SQL expressions are code constants supplied by query services, never request input.
  for (const selection of extraSelects)
    page.addSelect(selection.expression, selection.alias)
  const rows = await page.getRawMany<Record<string, unknown>>()
  return { rows, total: Number(count?.total ?? 0) }
}

/** Column names and aliases passed here are code constants, never query input. */
export function storedColumn(table: Table, alias: string, name: string) {
  if (!table.findColumnByName(name))
    throw new ConflictException('Required report column is missing: ' + name)
  return alias + '.`' + name + '`'
}
