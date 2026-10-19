import { randomUUID } from 'crypto'
import { QueryRunner } from 'typeorm'

export type GlobalAuditContext = {
  requestId: string
  sourceIp?: string
  actorAdminId?: number
  actorName?: string
}

export type GlobalAuditInput = {
  context: GlobalAuditContext
  operationId?: string
  actorType?: 'admin' | 'system'
  action: string
  targetType: string
  targetId?: string
  changeSummary?: Record<string, unknown>
  result: 'succeeded' | 'failed'
  errorCode?: string
}

export async function insertGlobalAudit(
  queryRunner: QueryRunner,
  input: GlobalAuditInput
) {
  await queryRunner.manager
    .createQueryBuilder()
    .insert()
    .into('ota_admin_audit_log')
    .values({
      audit_id: randomUUID(),
      operation_id: input.operationId ?? randomUUID(),
      part_no: 1,
      actor_type:
        input.actorType ??
        (input.context.actorAdminId !== undefined ? 'admin' : 'system'),
      actor_admin_id: input.context.actorAdminId,
      actor_name_snapshot: input.context.actorName,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      change_summary: input.changeSummary
        ? JSON.stringify(input.changeSummary)
        : undefined,
      result: input.result,
      error_code: input.errorCode,
      request_id: input.context.requestId,
      source_ip: input.context.sourceIp,
      created_at: new Date()
    })
    .execute()
}
