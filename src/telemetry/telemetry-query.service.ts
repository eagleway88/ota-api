import { Injectable } from '@nestjs/common'
import { QueryRunner, Table } from 'typeorm'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import {
  adminPage,
  AdminQueryWindow,
  normalizeAdminQuery,
  queryAdminPage,
  storedColumn
} from '@/infrastructure/persistence/admin-query'
import {
  ApplicationErrorQueryDto,
  TelemetryQueryDto
} from './telemetry-query.dto'

@Injectable()
export class TelemetryQueryService {
  constructor(private readonly read: AdminReadRepository) {}

  async summary(appName: string, query: TelemetryQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, application) => {
      const counts: number[] = []
      for (const name of [
        application.tables.success,
        application.tables.error
      ]) {
        const table = await this.read.requireTable(runner, name)
        const count = await this.reportFilter(
          runner,
          table,
          appName,
          query,
          window
        )
          .select('COUNT(*)', 'total')
          .getRawOne<{ total: string | number }>()
        counts.push(Number(count?.total ?? 0))
      }
      return {
        code: 0,
        data: {
          appName,
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          successCount: counts[0],
          errorCount: counts[1],
          countSemantics: 'report-records',
          receiveConfirmationAvailable: false
        }
      }
    })
  }

  async reports(
    appName: string,
    kind: 'success' | 'error',
    query: TelemetryQueryDto
  ) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, application) => {
      const table = await this.read.requireTable(
        runner,
        application.tables[kind]
      )
      const filter = this.reportFilter(runner, table, appName, query, window)
      const { rows, total } = await queryAdminPage(
        filter,
        'report',
        storedColumn(table, 'report', 'created_at', 'create_time'),
        'report.id',
        window,
        [{ expression: 'CAST(report.extras AS CHAR)', alias: 'extras_json' }]
      )
      return adminPage(
        rows.map(row => this.reportRecord(row, kind)),
        total,
        window,
        {
          countSemantics: 'report-records'
        }
      )
    })
  }

  async appErrors(appName: string, query: ApplicationErrorQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, application) => {
      const table = await this.read.requireTable(
        runner,
        application.tables.errorLog
      )
      const lastSeen = storedColumn(
        table,
        'report',
        'updated_at',
        'update_time',
        'created_at',
        'create_time'
      )
      const filter = runner.manager
        .createQueryBuilder()
        .from(table.name, 'report')
        .where('report.name = :appName', { appName })
        .andWhere(`${lastSeen} >= :from AND ${lastSeen} < :to`, {
          from: window.from,
          to: window.to
        })
      if (query.platform)
        filter.andWhere('report.platform = :platform', {
          platform: query.platform
        })
      if (query.kind)
        filter.andWhere('report.kind = :kind', { kind: query.kind })
      if (query.errorHash)
        filter.andWhere('report.error_hash = :errorHash', {
          errorHash: query.errorHash
        })
      const { rows, total } = await queryAdminPage(
        filter,
        'report',
        lastSeen,
        'report.id',
        window,
        [{ expression: 'CAST(report.extras AS CHAR)', alias: 'extras_json' }]
      )
      return adminPage(
        rows.map(row => ({
          id: Number(row.id),
          appName: row.name,
          platform: row.platform,
          versionCode: Number(row.ver),
          errorHash: row.error_hash,
          kind: row.kind,
          message: row.message,
          stack: row.stack,
          reportCount: Number(row.report_count ?? 1),
          reportedUsername: row.reported_username ?? row.username,
          sourceIp: row.ip,
          extras: this.json(row.extras_json),
          firstSeenAt: row.created_at ?? row.create_time,
          lastSeenAt:
            row.updated_at ??
            row.update_time ??
            row.created_at ??
            row.create_time
        })),
        total,
        window,
        {
          windowBasis: 'lastSeenAt',
          countSemantics: 'aggregated-groups',
          reportCountSemantics:
            'lifetime-count-for-each-group-not-count-within-query-window'
        }
      )
    })
  }

  private reportFilter(
    runner: QueryRunner,
    table: Table,
    appName: string,
    query: TelemetryQueryDto,
    window: AdminQueryWindow
  ) {
    const createdAt = storedColumn(table, 'report', 'created_at', 'create_time')
    const filter = runner.manager
      .createQueryBuilder()
      .from(table.name, 'report')
      .where('report.name = :appName', { appName })
      .andWhere(`${createdAt} >= :from AND ${createdAt} < :to`, {
        from: window.from,
        to: window.to
      })
    if (query.platform)
      filter.andWhere('report.platform = :platform', {
        platform: query.platform
      })
    if (query.releaseSequence)
      filter.andWhere(
        `${storedColumn(table, 'report', 'release_sequence', 'ver_id')} = :releaseSequence`,
        { releaseSequence: Number(query.releaseSequence) }
      )
    return filter
  }

  private reportRecord(
    row: Record<string, unknown>,
    kind: 'success' | 'error'
  ) {
    return {
      id: Number(row.id),
      reportId: row.report_id ?? null,
      appName: row.name,
      platform: row.platform,
      versionCode: Number(row.ver),
      releaseSequence: Number(row.release_sequence ?? row.ver_id),
      reportedUsername: row.reported_username ?? row.username,
      sourceIp: row.ip,
      extras: this.json(row.extras_json),
      createdAt: row.created_at ?? row.create_time,
      ...(kind === 'error'
        ? {
            message: row.message,
            updatedAt:
              row.updated_at ??
              row.update_time ??
              row.created_at ??
              row.create_time
          }
        : {})
    }
  }

  private json(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }
}
