import { randomUUID } from 'crypto'
import { QueryRunner } from 'typeorm'

export type GlobalAuditContext = {
  requestId: string
  sourceIp?: string
  actorKeyId?: string
  actorType?: 'system' | 'api_key' | 'operator'
  actorName?: string
}

export type GlobalAuditInput = {
  context: GlobalAuditContext
  operationId?: string
  actorType?: GlobalAuditContext['actorType']
  action: string
  targetType: string
  targetId?: string
  changeSummary?: Record<string, unknown>
  result: 'succeeded' | 'failed'
  errorCode?: string
}

export async function insertAudit(
  queryRunner: QueryRunner,
  input: GlobalAuditInput,
  table: string
) {
  await queryRunner.manager
    .createQueryBuilder()
    .insert()
    .into(table)
    .values({
      audit_id: randomUUID(),
      operation_id: input.operationId ?? randomUUID(),
      part_no: 1,
      actor_type: input.actorType ?? input.context.actorType ?? 'system',
      ...(input.context.actorKeyId
        ? { actor_key_id: input.context.actorKeyId }
        : {}),
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

export function insertGlobalAudit(
  runner: QueryRunner,
  input: GlobalAuditInput
) {
  return insertAudit(runner, input, 'ota_audit_log')
}
