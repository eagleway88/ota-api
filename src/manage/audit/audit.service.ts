import { Injectable } from '@nestjs/common'
import { QueryRunner } from 'typeorm'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import {
  adminPage,
  AdminQueryWindow,
  normalizeAdminQuery,
  queryAdminPage
} from '@/infrastructure/persistence/admin-query'
import {
  ApplicationAuditQueryDto,
  AuditQueryDto
} from '@/manage/audit/audit.dto'

@Injectable()
export class AuditQueryService {
  constructor(private readonly read: AdminReadRepository) {}

  listGlobal(query: AuditQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withConnection(runner =>
      this.query(runner, 'ota_audit_log', query, window)
    )
  }

  listApplication(appName: string, query: ApplicationAuditQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, (runner, application) =>
      this.query(runner, application.tables.auditLog, query, window, true)
    )
  }

  private async query(
    runner: QueryRunner,
    tableName: string,
    query: ApplicationAuditQueryDto,
    window: AdminQueryWindow,
    application = false
  ) {
    await this.read.requireTable(runner, tableName)
    const filter = runner.manager
      .createQueryBuilder()
      .from(tableName, 'audit')
      .where('audit.created_at >= :from AND audit.created_at < :to', {
        from: window.from,
        to: window.to
      })
    const fields: Record<string, unknown> = {
      action: query.action,
      result: query.result,
      actor_key_id: query.actorKeyId,
      request_id: query.requestId,
      operation_id: query.operationId,
      ...(application
        ? { release_id: query.releaseId, task_id: query.taskId }
        : {})
    }
    for (const [column, value] of Object.entries(fields)) {
      if (value !== undefined)
        filter.andWhere(`audit.${column} = :${column}`, { [column]: value })
    }
    const { rows, total } = await queryAdminPage(
      filter,
      'audit',
      'audit.created_at',
      'audit.audit_id',
      window
    )
    return adminPage(rows, total, window, {
      retention: 'permanent' as const
    })
  }
}
