import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  NotFoundException
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { apiUtil } from '@/utils/api'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { mapLegacyReleaseRecord } from '@/compat/legacy/mappers/release.mapper'
import { normalizeLegacyReleaseAudience } from '@/compat/legacy/http/release-audience.mapper'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { WsService } from '@/ws/ws.service'
import {
  canClaimPublishTask,
  PublishTaskStatus,
  publishTaskFailureTransition
} from '@/infrastructure/tasks/publish-task-policy'
import {
  ChangeReleaseScopeDto,
  AuditListQueryDto,
  ReleaseListQueryDto,
  ReplaceReleaseUsersDto,
  TaskListQueryDto
} from './release-management.dto'

export type ReleaseOperationContext = {
  requestId: string
  sourceIp?: string
  actorAdminId?: number
  actorName?: string
}

type PolicyMutation = {
  action: 'publish' | 'enable' | 'disable' | 'audience_changed' | 'redispatch'
  expectedRevision?: number
  changeSummary: Record<string, unknown>
  mutate: (
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    release: Record<string, unknown>
  ) => Promise<void>
}

function databaseDate(value: unknown) {
  if (value instanceof Date) {
    return value
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }
  return null
}

@Injectable()
export class ReleaseManagementService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReleaseManagementService.name)
  private readonly workerId = `ota-${process.pid}-${randomUUID().slice(0, 8)}`
  private taskTimer?: NodeJS.Timeout
  private recoveringTasks = false

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationRegistryService,
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly wsService: WsService
  ) {}

  onModuleInit() {
    void this.recoverTasks()
    this.taskTimer = setInterval(() => void this.recoverTasks(), 5_000)
    this.taskTimer.unref()
  }

  onModuleDestroy() {
    if (this.taskTimer) {
      clearInterval(this.taskTimer)
    }
  }

  async prepare(appName: string) {
    const application = await this.applications.prepare(appName)
    return apiUtil.data({
      appName: application.appName,
      tablePrefix: application.tablePrefix,
      schemaVersion: application.schemaVersion,
      status: application.status
    })
  }

  async enqueuePublishedRelease(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string,
    context: ReleaseOperationContext
  ) {
    const operationId = randomUUID()
    const taskId = randomUUID()
    await queryRunner.manager
      .createQueryBuilder()
      .update('ota_applications')
      .set({
        catalog_revision: () => 'catalog_revision + 1',
        updated_at: new Date()
      })
      .where('app_name = :appName', { appName: application.appName })
      .execute()
    await this.insertTask(queryRunner, application, {
      taskId,
      operationId,
      releaseId,
      action: 'publish',
      revision: 1
    })
    await this.insertAudit(queryRunner, application, {
      context,
      taskId,
      operationId,
      releaseId,
      action: 'publish',
      revisionBefore: 0,
      revisionAfter: 1,
      changeSummary: { source: 'legacy-http' }
    })
    return { taskId, operationId }
  }

  async executePersistedTask(
    application: RegisteredApplication,
    taskId: string,
    requestId?: string
  ) {
    return this.executeTask(application, taskId, requestId)
  }

  async list(appName: string, query: ReleaseListQueryDto) {
    const application = await this.applications.resolve(appName)
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.version))) {
        return apiUtil.page([], 0)
      }
      const count = await queryRunner.manager
        .createQueryBuilder()
        .select('COUNT(*)', 'total')
        .from(application.tables.version, 'version')
        .where('version.name = :appName', { appName })
        .getRawOne<{ total: string | number }>()
      const records = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.version, 'version')
        .where('version.name = :appName', { appName })
        .orderBy('version.id', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawMany<Record<string, unknown>>()
      return apiUtil.page(
        records.map(record => this.toManagementRelease(record)),
        Number(count?.total ?? 0)
      )
    } finally {
      await queryRunner.release()
    }
  }

  async detail(appName: string, releaseId: string) {
    const { release } = await this.findRelease(appName, releaseId)
    return apiUtil.data(this.toManagementRelease(release))
  }

  async users(appName: string, releaseId: string) {
    const { application } = await this.findRelease(appName, releaseId)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.releaseUser))) {
        return apiUtil.data([])
      }
      const rows = await queryRunner.manager
        .createQueryBuilder()
        .select('audience.user_id', 'userId')
        .from(application.tables.releaseUser, 'audience')
        .where('audience.release_id = :releaseId', { releaseId })
        .orderBy('audience.user_id', 'ASC')
        .getRawMany<{ userId: string }>()
      return apiUtil.data(rows.map(row => row.userId))
    } finally {
      await queryRunner.release()
    }
  }

  async replaceUsers(
    appName: string,
    releaseId: string,
    body: ReplaceReleaseUsersDto,
    context: ReleaseOperationContext
  ) {
    const normalized = normalizeLegacyReleaseAudience({
      appName,
      platforms: (await this.findRelease(appName, releaseId)).release
        .platform as string,
      releaseScope: 'allowlist',
      userIds: body.userIds
    })
    return this.mutatePolicy(appName, releaseId, context, {
      action: 'audience_changed',
      expectedRevision: body.expectedRevision,
      changeSummary: { userCount: normalized.userIds.length },
      mutate: async (queryRunner, application) => {
        await queryRunner.manager
          .createQueryBuilder()
          .delete()
          .from(application.tables.releaseUser)
          .where('release_id = :releaseId', { releaseId })
          .execute()
        if (normalized.userIds.length) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(application.tables.releaseUser)
            .values(
              normalized.userIds.map(userId => ({
                release_id: releaseId,
                user_id: userId,
                created_at: new Date()
              }))
            )
            .execute()
        }
      }
    })
  }

  async changeScope(
    appName: string,
    releaseId: string,
    body: ChangeReleaseScopeDto,
    context: ReleaseOperationContext
  ) {
    return this.mutatePolicy(appName, releaseId, context, {
      action: 'audience_changed',
      expectedRevision: body.expectedRevision,
      changeSummary: { releaseScope: body.releaseScope },
      mutate: async (queryRunner, application) => {
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.version)
          .set({ release_scope: body.releaseScope })
          .where('release_id = :releaseId', { releaseId })
          .execute()
      }
    })
  }

  async setEnabled(
    appName: string,
    releaseId: string,
    enabled: boolean,
    context: ReleaseOperationContext
  ) {
    return this.mutatePolicy(appName, releaseId, context, {
      action: enabled ? 'enable' : 'disable',
      changeSummary: { enabled },
      mutate: async (queryRunner, application) => {
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.version)
          .set({ enable: enabled ? 1 : 0 })
          .where('release_id = :releaseId', { releaseId })
          .execute()
      }
    })
  }

  async redispatch(
    appName: string,
    releaseId: string,
    context: ReleaseOperationContext
  ) {
    return this.mutatePolicy(appName, releaseId, context, {
      action: 'redispatch',
      changeSummary: { redispatch: true },
      mutate: () => Promise.resolve()
    })
  }

  async tasks(appName: string, query: TaskListQueryDto) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.publishTask))) {
        return apiUtil.page([], 0)
      }
      const page = Math.max(Number(query.page) || 1, 1)
      const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
      const filter = queryRunner.manager
        .createQueryBuilder()
        .from(application.tables.publishTask, 'task')
      if (query.status) {
        filter.andWhere('task.status = :status', { status: query.status })
      }
      if (query.releaseId) {
        filter.andWhere('task.release_id = :releaseId', {
          releaseId: query.releaseId
        })
      }
      const count = await filter
        .clone()
        .select('COUNT(*)', 'total')
        .getRawOne<{ total: string | number }>()
      const rows = await filter
        .select('task.*')
        .orderBy('task.created_at', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawMany<Record<string, unknown>>()
      return apiUtil.page(rows, Number(count?.total ?? 0))
    } finally {
      await queryRunner.release()
    }
  }

  async task(appName: string, taskId: string) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.publishTask))) {
        throw new NotFoundException('Task does not exist or is past retention')
      }
      const task = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTask, 'task')
        .where('task.task_id = :taskId', { taskId })
        .getRawOne<Record<string, unknown>>()
      if (!task) {
        throw new NotFoundException('Task does not exist or is past retention')
      }
      const latestLog = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTaskLog, 'log')
        .where('log.task_id = :taskId', { taskId })
        .orderBy('log.attempt_no', 'DESC')
        .getRawOne<Record<string, unknown>>()
      return apiUtil.data({ task, latestLog: latestLog ?? null })
    } finally {
      await queryRunner.release()
    }
  }

  async taskLogs(appName: string, taskId: string, query: ReleaseListQueryDto) {
    await this.task(appName, taskId)
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
    await queryRunner.connect()
    try {
      const count = await queryRunner.manager
        .createQueryBuilder()
        .select('COUNT(*)', 'total')
        .from(application.tables.publishTaskLog, 'log')
        .where('log.task_id = :taskId', { taskId })
        .getRawOne<{ total: string | number }>()
      const rows = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTaskLog, 'log')
        .where('log.task_id = :taskId', { taskId })
        .orderBy('log.attempt_no', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawMany<Record<string, unknown>>()
      return apiUtil.page(rows, Number(count?.total ?? 0))
    } finally {
      await queryRunner.release()
    }
  }

  async auditLogs(appName: string, query: AuditListQueryDto) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    const page = Math.max(Number(query.page) || 1, 1)
    const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.auditLog))) {
        return apiUtil.page([], 0)
      }
      const filter = queryRunner.manager
        .createQueryBuilder()
        .from(application.tables.auditLog, 'audit')
      if (query.action) {
        filter.andWhere('audit.action = :action', { action: query.action })
      }
      const count = await filter
        .clone()
        .select('COUNT(*)', 'total')
        .getRawOne<{ total: string | number }>()
      const rows = await filter
        .select('audit.*')
        .orderBy('audit.created_at', 'DESC')
        .skip((page - 1) * pageSize)
        .take(pageSize)
        .getRawMany<Record<string, unknown>>()
      return apiUtil.page(rows, Number(count?.total ?? 0))
    } finally {
      await queryRunner.release()
    }
  }

  async delivery(appName: string, releaseId: string) {
    await this.findRelease(appName, releaseId)
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.publishTask))) {
        return apiUtil.data({
          releaseId,
          tasks: [],
          receiveConfirmationAvailable: false
        })
      }
      const tasks = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTask, 'task')
        .where('task.release_id = :releaseId', { releaseId })
        .orderBy('task.created_at', 'DESC')
        .getRawMany<Record<string, unknown>>()
      return apiUtil.data({
        releaseId,
        tasks,
        receiveConfirmationAvailable: false,
        note: 'Counts represent server send attempts, not unique recipients or installations.'
      })
    } finally {
      await queryRunner.release()
    }
  }

  private async mutatePolicy(
    appName: string,
    releaseId: string,
    context: ReleaseOperationContext,
    mutation: PolicyMutation
  ) {
    const application = await this.applications.prepare(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    const operationId = randomUUID()
    const taskId = randomUUID()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    let revisionAfter = 0
    try {
      const release = await this.lockRelease(
        queryRunner,
        application,
        releaseId
      )
      const revisionBefore = Number(release.policy_revision) || 1
      if (
        mutation.expectedRevision !== undefined &&
        mutation.expectedRevision !== revisionBefore
      ) {
        throw new ConflictException('Release policy revision has changed')
      }
      await mutation.mutate(queryRunner, application, release)
      revisionAfter = revisionBefore + 1
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.version)
        .set({ policy_revision: revisionAfter })
        .where('release_id = :releaseId', { releaseId })
        .execute()
      await queryRunner.manager
        .createQueryBuilder()
        .update('ota_applications')
        .set({
          catalog_revision: () => 'catalog_revision + 1',
          updated_at: new Date()
        })
        .where('app_name = :appName', { appName })
        .execute()
      await this.insertTask(queryRunner, application, {
        taskId,
        operationId,
        releaseId,
        action: mutation.action,
        revision: revisionAfter
      })
      await this.insertAudit(queryRunner, application, {
        context,
        taskId,
        operationId,
        releaseId,
        action: mutation.action,
        revisionBefore,
        revisionAfter,
        changeSummary: mutation.changeSummary
      })
      await queryRunner.commitTransaction()
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }

    this.otaVersionQueryService.invalidate(appName)
    await this.executeTask(application, taskId, context.requestId)
    return apiUtil.data({
      taskId,
      operationId,
      releaseId,
      revision: revisionAfter
    })
  }

  private async executeTask(
    application: RegisteredApplication,
    taskId: string,
    requestId?: string
  ) {
    const claimed = await this.claimTask(application, taskId, requestId)
    if (!claimed) {
      return false
    }

    const { attemptNo, leaseToken, logId, startedAt } = claimed
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const result = await this.wsService.dispatchApplicationUpdate(
        application.appName,
        () => this.hasTaskLease(application, taskId, leaseToken)
      )
      const finishedAt = new Date()
      await queryRunner.startTransaction()
      const completion = await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTask)
        .set({
          status: 'succeeded',
          lease_owner: null,
          lease_until: null,
          updated_at: finishedAt,
          finished_at: finishedAt
        })
        .where(
          'task_id = :taskId AND status = :status AND lease_token = :leaseToken',
          { taskId, status: 'running', leaseToken }
        )
        .execute()
      if (!completion.affected) {
        await queryRunner.rollbackTransaction()
        return false
      }
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTaskLog)
        .set({
          status: 'succeeded',
          finished_at: finishedAt,
          duration_ms: finishedAt.getTime() - startedAt.getTime(),
          scanned_count: result.scanned,
          eligible_count: result.updated,
          update_emit_count: result.updated,
          revoke_emit_count: result.revoked,
          metrics_complete: 1,
          last_checkpoint_at: finishedAt
        })
        .where('log_id = :logId AND status = :status', {
          logId,
          status: 'running'
        })
        .execute()
      await queryRunner.commitTransaction()
      return true
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      const failedAt = new Date()
      const summary =
        error instanceof Error ? error.message.slice(0, 512) : 'Dispatch failed'
      const task = await queryRunner.manager
        .createQueryBuilder()
        .select(['task.max_attempts'])
        .from(application.tables.publishTask, 'task')
        .where('task.task_id = :taskId', { taskId })
        .getRawOne<{ max_attempts: number | string }>()
      const transition = publishTaskFailureTransition(
        attemptNo,
        Number(task?.max_attempts ?? 5),
        failedAt
      )
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTask)
        .set({
          status: transition.status,
          next_run_at: transition.nextRunAt,
          lease_owner: null,
          lease_until: null,
          last_error_code: 'dispatch_failed',
          last_error_summary: summary,
          updated_at: failedAt,
          finished_at: transition.finishedAt
        })
        .where(
          'task_id = :taskId AND status = :status AND lease_token = :leaseToken',
          { taskId, status: 'running', leaseToken }
        )
        .execute()
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTaskLog)
        .set({
          status: 'failed',
          finished_at: failedAt,
          duration_ms: failedAt.getTime() - startedAt.getTime(),
          error_code: 'dispatch_failed',
          error_summary: summary,
          metrics_complete: 0
        })
        .where('log_id = :logId AND status = :status', {
          logId,
          status: 'running'
        })
        .execute()
      return false
    } finally {
      await queryRunner.release()
    }
  }

  private async claimTask(
    application: RegisteredApplication,
    taskId: string,
    requestId?: string
  ) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const task = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTask, 'task')
        .setLock('pessimistic_write')
        .where('task.task_id = :taskId', { taskId })
        .getRawOne<Record<string, unknown>>()
      if (!task) {
        await queryRunner.commitTransaction()
        return null
      }

      const status = String(task.status) as PublishTaskStatus
      const now = new Date()
      const nextRunAt = databaseDate(task.next_run_at)
      const leaseUntil = databaseDate(task.lease_until)
      const leaseExpired =
        status === 'running' &&
        Boolean(leaseUntil && leaseUntil.getTime() <= now.getTime())
      if (!canClaimPublishTask(status, nextRunAt, leaseUntil, now)) {
        await queryRunner.commitTransaction()
        return null
      }

      if (leaseExpired) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.publishTaskLog)
          .set({
            status: 'lease_expired',
            finished_at: now,
            error_code: 'lease_expired',
            error_summary: 'Worker lease expired before completion',
            metrics_complete: 0
          })
          .where('task_id = :taskId AND status = :status', {
            taskId,
            status: 'running'
          })
          .execute()
      }

      const attemptNo = Number(task.attempt_count) + 1
      const maximumAttempts = Number(task.max_attempts) || 5
      if (attemptNo > maximumAttempts) {
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.publishTask)
          .set({ status: 'failed', finished_at: now, updated_at: now })
          .where('task_id = :taskId', { taskId })
          .execute()
        await queryRunner.commitTransaction()
        return null
      }

      const leaseToken = Number(task.lease_token) + 1
      const logId = randomUUID()
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTask)
        .set({
          status: 'running',
          attempt_count: attemptNo,
          lease_owner: this.workerId,
          lease_token: leaseToken,
          lease_until: new Date(now.getTime() + 300_000),
          updated_at: now,
          finished_at: null
        })
        .where('task_id = :taskId', { taskId })
        .execute()
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(application.tables.publishTaskLog)
        .values({
          log_id: logId,
          task_id: taskId,
          attempt_no: attemptNo,
          worker_id: this.workerId,
          lease_token: leaseToken,
          status: 'running',
          effective_revision: Number(task.requested_revision),
          started_at: now,
          metrics_complete: 0,
          request_id: requestId
        })
        .execute()
      await queryRunner.commitTransaction()
      return {
        attemptNo,
        leaseToken,
        logId,
        startedAt: now
      }
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
  }

  private async hasTaskLease(
    application: RegisteredApplication,
    taskId: string,
    leaseToken: number
  ) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const task = await queryRunner.manager
        .createQueryBuilder()
        .select('task.task_id', 'taskId')
        .from(application.tables.publishTask, 'task')
        .where('task.task_id = :taskId', { taskId })
        .andWhere('task.status = :status', { status: 'running' })
        .andWhere('task.lease_token = :leaseToken', { leaseToken })
        .andWhere('task.lease_until > :now', { now: new Date() })
        .getRawOne<{ taskId: string }>()
      return Boolean(task)
    } finally {
      await queryRunner.release()
    }
  }

  private async recoverTasks() {
    if (this.recoveringTasks) {
      return
    }
    this.recoveringTasks = true
    try {
      const applications = await this.applications.listReady()
      for (const application of applications) {
        const queryRunner = this.dataSource.createQueryRunner()
        await queryRunner.connect()
        try {
          if (!(await queryRunner.hasTable(application.tables.publishTask))) {
            continue
          }
          const tasks = await queryRunner.manager
            .createQueryBuilder()
            .select('task.task_id', 'taskId')
            .from(application.tables.publishTask, 'task')
            .where(
              `(
                (task.status IN (:...waitingStatuses) AND task.next_run_at <= :now)
                OR (task.status = :runningStatus AND task.lease_until <= :now)
              )`,
              {
                waitingStatuses: ['pending', 'retry_wait'],
                runningStatus: 'running',
                now: new Date()
              }
            )
            .orderBy('task.created_at', 'ASC')
            .take(10)
            .getRawMany<{ taskId: string }>()
          for (const task of tasks) {
            await this.executeTask(application, task.taskId)
          }
        } finally {
          await queryRunner.release()
        }
      }
    } catch (error) {
      this.logger.error(
        'Publish task recovery failed',
        error instanceof Error ? error.stack : undefined
      )
    } finally {
      this.recoveringTasks = false
    }
  }

  private async findRelease(appName: string, releaseId: string) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.version))) {
        throw new NotFoundException('Release does not exist')
      }
      const release = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.version, 'version')
        .where('version.release_id = :releaseId', { releaseId })
        .andWhere('version.name = :appName', { appName })
        .getRawOne<Record<string, unknown>>()
      if (!release) {
        throw new NotFoundException('Release does not exist')
      }
      return { application, release }
    } finally {
      await queryRunner.release()
    }
  }

  private async lockRelease(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string
  ) {
    const release = await queryRunner.manager
      .createQueryBuilder()
      .select('*')
      .from(application.tables.version, 'version')
      .setLock('pessimistic_write')
      .where('version.release_id = :releaseId', { releaseId })
      .andWhere('version.name = :appName', { appName: application.appName })
      .getRawOne<Record<string, unknown>>()
    if (!release) {
      throw new NotFoundException('Release does not exist')
    }
    return release
  }

  private async insertTask(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    input: {
      taskId: string
      operationId: string
      releaseId: string
      action: PolicyMutation['action']
      revision: number
    }
  ) {
    const now = new Date()
    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.publishTask)
      .values({
        task_id: input.taskId,
        operation_id: input.operationId,
        release_id: input.releaseId,
        action: input.action,
        requested_revision: input.revision,
        status: 'pending',
        attempt_count: 0,
        max_attempts: 5,
        next_run_at: now,
        lease_token: 0,
        created_at: now,
        updated_at: now
      })
      .execute()
  }

  private async insertAudit(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    input: {
      context: ReleaseOperationContext
      taskId: string
      operationId: string
      releaseId: string
      action: PolicyMutation['action']
      revisionBefore: number
      revisionAfter: number
      changeSummary: Record<string, unknown>
    }
  ) {
    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.auditLog)
      .values({
        audit_id: randomUUID(),
        operation_id: input.operationId,
        part_no: 1,
        actor_type: 'admin',
        actor_admin_id: input.context.actorAdminId,
        actor_name_snapshot: input.context.actorName,
        action: input.action,
        target_type: 'release',
        target_id: input.releaseId,
        release_id: input.releaseId,
        task_id: input.taskId,
        revision_before: input.revisionBefore,
        revision_after: input.revisionAfter,
        change_summary: JSON.stringify(input.changeSummary),
        result: 'succeeded',
        request_id: input.context.requestId,
        source_ip: input.context.sourceIp,
        created_at: new Date()
      })
      .execute()
  }

  private toManagementRelease(record: Record<string, unknown>) {
    const release = mapLegacyReleaseRecord(record)
    return {
      releaseId: release.releaseId,
      releaseSequence: release.releaseSequence,
      appName: release.appName,
      targetVersionCode: release.targetVersionCode,
      compatibleBaseVersionCodes: release.compatibleBaseVersionCodes,
      platforms: release.platforms,
      architectures: release.architectures,
      distributionChannel: release.distributionChannel,
      updateType: release.updateType,
      releaseScope: release.scope,
      enabled: release.enabled,
      mandatory: release.mandatory,
      showUpdateDialog: release.showUpdateDialog,
      policyRevision: Number(release.legacyPayload.policyRevision) || 1,
      installerSourceUrl: release.legacyPayload.installUrl,
      bundleUrl: release.legacyPayload.packageUrl,
      releaseNotes: release.legacyPayload.desc,
      artifactSizeBytes: release.legacyPayload.fileSize,
      createdAt: release.legacyPayload.createTime
    }
  }
}
