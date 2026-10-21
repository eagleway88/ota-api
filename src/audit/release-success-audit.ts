import { randomUUID } from 'crypto'
import { QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import type { ReleaseOperationContext } from '@/contracts/release-operation'
import type { ApplicationWriteAudit } from './application-write-audit'
import type { AudienceChange } from './audience-change'

export type ReleaseSuccessAudit = {
  context: ReleaseOperationContext
  operationId: string
  releaseId: string
  action: ApplicationWriteAudit['action']
  targetType?: 'release' | 'release_draft'
  taskId?: string
  revisionBefore?: number
  revisionAfter?: number
  changeSummary: Record<string, unknown>
  audience?: AudienceChange
  now?: Date
}

/** Caller owns the transaction; every bounded part must commit or roll back together. */
export async function insertReleaseSuccessAudit(
  runner: QueryRunner,
  application: RegisteredApplication,
  input: ReleaseSuccessAudit
) {
  if (!runner.isTransactionActive)
    throw new Error('Success audit requires a transaction')
  const now = input.now ?? new Date()
  const details = input.audience?.parts ?? [null]
  for (const [index, detail] of details.entries()) {
    await runner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.auditLog)
      .values({
        audit_id: randomUUID(),
        operation_id: input.operationId,
        part_no: index + 1,
        actor_type:
          input.context.actorAdminId === undefined ? 'system' : 'admin',
        actor_admin_id: input.context.actorAdminId,
        actor_name_snapshot: input.context.actorName,
        action: input.action,
        target_type: input.targetType ?? 'release',
        target_id: input.releaseId,
        release_id: input.releaseId,
        task_id: input.taskId ?? null,
        revision_before: input.revisionBefore ?? null,
        revision_after: input.revisionAfter ?? null,
        change_summary: JSON.stringify({
          ...input.changeSummary,
          ...(input.audience ? { audience: input.audience.summary } : {})
        }),
        change_detail: detail ? JSON.stringify(detail) : null,
        result: 'succeeded',
        request_id: input.context.requestId,
        source_ip: input.context.sourceIp,
        created_at: now
      })
      .execute()
  }
}
