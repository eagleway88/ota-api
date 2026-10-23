import { HttpException, Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DataSource, QueryFailedError, QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import type { ReleaseOperationContext } from '@/contracts/release-operation'
import type { ReleaseScope } from '@/contracts/releases'
import {
  ApplicationWriteState,
  withApplicationWrite
} from '@/infrastructure/persistence/application-write-transaction'

// Only operation metadata belongs here, never DTOs, URLs, user lists or errors.
export type ApplicationWriteAudit = {
  operationId: string
  context: ReleaseOperationContext
  releaseId: string
  action:
    | 'publish'
    | 'enable'
    | 'disable'
    | 'audience_changed'
    | 'draft_audience_changed'
    | 'draft_created'
    | 'draft_updated'
    | 'redispatch'
  targetType: 'release' | 'release_draft'
  changeSummary?: {
    enabled?: boolean
    redispatch?: boolean
    releaseScope?: ReleaseScope
    userCount?: number
  }
}

const logger = new Logger('ApplicationWriteAudit')

function safeSummary(summary: ApplicationWriteAudit['changeSummary']) {
  return {
    ...(typeof summary?.enabled === 'boolean'
      ? { enabled: summary.enabled }
      : {}),
    ...(typeof summary?.redispatch === 'boolean'
      ? { redispatch: summary.redispatch }
      : {}),
    ...(['public', 'allowlist'].includes(summary?.releaseScope ?? '')
      ? { releaseScope: summary?.releaseScope }
      : {}),
    ...(typeof summary?.userCount === 'number' &&
    Number.isSafeInteger(summary.userCount) &&
    summary.userCount >= 0
      ? { userCount: summary.userCount }
      : {})
  }
}

function failureCode(error: unknown): string {
  if (error instanceof HttpException) {
    switch (error.getStatus()) {
      case 400:
        return 'INVALID_OPERATION'
      case 404:
        return 'RELEASE_NOT_FOUND'
      case 409:
        return 'OPERATION_CONFLICT'
    }
  }
  return error instanceof QueryFailedError
    ? 'DATABASE_WRITE_FAILED'
    : 'APPLICATION_OPERATION_FAILED'
}

/** Success audit stays in write(); failure audit starts only after confirmed rollback. */
export async function withAuditedApplicationWrite<T>(
  source: DataSource,
  application: RegisteredApplication,
  audit: ApplicationWriteAudit,
  write: (runner: QueryRunner) => Promise<T>
): Promise<T> {
  const state: ApplicationWriteState = { outcome: 'not_started' }
  try {
    return await withApplicationWrite(source, application, write, state)
  } catch (error) {
    const fields = {
      appName: application.appName,
      operationId: audit.operationId,
      requestId: audit.context.requestId,
      action: audit.action,
      outcome: state.outcome
    }
    if (!['not_started', 'rolled_back'].includes(state.outcome)) {
      // No failure row when COMMIT may have succeeded, or cleanup failed afterwards.
      logger.error({
        event: 'application_operation_outcome_requires_review',
        ...fields
      })
      throw error
    }
    try {
      // A new connection/transaction also revalidates the application mapping.
      // Missing tables and unavailable databases fail closed; no DDL or repair.
      await withApplicationWrite(source, application, async runner => {
        await runner.manager
          .createQueryBuilder()
          .insert()
          .into(application.tables.auditLog)
          .values({
            audit_id: randomUUID(),
            operation_id: audit.operationId,
            part_no: 1,
            actor_type: audit.context.actorType ?? 'system',
            ...(audit.context.actorKeyId
              ? { actor_key_id: audit.context.actorKeyId }
              : {}),
            actor_name_snapshot: audit.context.actorName,
            action: audit.action,
            target_type: audit.targetType,
            target_id: audit.releaseId,
            release_id: audit.releaseId,
            task_id: null,
            revision_before: null,
            revision_after: null,
            change_summary: JSON.stringify(safeSummary(audit.changeSummary)),
            result: 'failed',
            error_code: failureCode(error),
            request_id: audit.context.requestId,
            source_ip: audit.context.sourceIp,
            created_at: new Date()
          })
          .execute()
      })
    } catch {
      logger.error({
        event: 'application_failure_audit_unavailable',
        ...fields
      })
    }
    throw error
  }
}
