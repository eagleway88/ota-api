import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { WsService } from '@/ws/ws.service'
import {
  canClaimPublishTask,
  PublishTaskStatus,
  publishTaskFailureTransition
} from './publish-task-policy'

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
export class PublishTaskWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PublishTaskWorkerService.name)
  private readonly workerId = `ota-${process.pid}-${randomUUID().slice(0, 8)}`
  private taskTimer?: NodeJS.Timeout
  private recoveringTasks = false

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly applications: ApplicationRegistryService,
    private readonly wsService: WsService
  ) {}

  onModuleInit() {
    void this.recoverTasks()
    const pollMs = Number(
      this.configService.get('PUBLISH_TASK_POLL_MS') ?? 5_000
    )
    this.taskTimer = setInterval(() => void this.recoverTasks(), pollMs)
    this.taskTimer.unref()
  }

  onModuleDestroy() {
    if (this.taskTimer) {
      clearInterval(this.taskTimer)
    }
  }

  async execute(
    application: RegisteredApplication,
    taskId: string,
    requestId?: string
  ) {
    if (this.configService.get('PUBLISH_TASKS_PAUSED') === 'true') {
      return false
    }
    const claimed = await this.claimTask(application, taskId, requestId)
    if (!claimed) {
      return false
    }

    const { attemptNo, leaseToken, logId, startedAt, effectiveRevision } =
      claimed
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const result = await this.wsService.dispatchApplicationUpdate(
        application.appName,
        () =>
          this.renewTaskLease(
            application,
            taskId,
            leaseToken,
            effectiveRevision
          )
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
      const logCompletion = await queryRunner.manager
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
      if (!logCompletion.affected) {
        await queryRunner.rollbackTransaction()
        return false
      }
      await queryRunner.commitTransaction()
      return true
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      const failedAt = new Date()
      const summary =
        error instanceof Error ? error.message.slice(0, 512) : 'Dispatch failed'
      const errorCode = summary.includes('catalog revision')
        ? 'catalog_revision_changed'
        : summary.includes('lease')
          ? 'lease_lost'
          : 'dispatch_failed'
      await queryRunner.startTransaction()
      const task = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.publishTask, 'task')
        .setLock('pessimistic_write')
        .where(
          'task.task_id = :taskId AND task.status = :status AND task.lease_token = :leaseToken',
          { taskId, status: 'running', leaseToken }
        )
        .getRawOne<Record<string, unknown>>()
      if (!task) {
        await queryRunner.commitTransaction()
        return false
      }
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
          last_error_code: errorCode,
          last_error_summary: summary,
          updated_at: failedAt,
          finished_at: transition.finishedAt
        })
        .where('task_id = :taskId', { taskId })
        .execute()
      const logFailure = await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTaskLog)
        .set({
          status: 'failed',
          finished_at: failedAt,
          duration_ms: failedAt.getTime() - startedAt.getTime(),
          error_code: errorCode,
          error_summary: summary,
          metrics_complete: 0
        })
        .where('log_id = :logId AND status = :status', {
          logId,
          status: 'running'
        })
        .execute()
      if (!logFailure.affected) {
        await queryRunner.rollbackTransaction()
        return false
      }
      await queryRunner.commitTransaction()
      return false
    } finally {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
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
      const catalog = await queryRunner.manager
        .createQueryBuilder()
        .select('application.catalog_revision', 'catalogRevision')
        .from('ota_applications', 'application')
        .setLock('pessimistic_read')
        .where('application.app_name = :appName', {
          appName: application.appName
        })
        .getRawOne<{ catalogRevision: number | string }>()
      const effectiveRevision = Number(catalog?.catalogRevision)
      if (!Number.isSafeInteger(effectiveRevision)) {
        throw new Error('Application catalog revision is unavailable')
      }
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
          effective_revision: effectiveRevision,
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
        startedAt: now,
        effectiveRevision
      }
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
  }

  private async renewTaskLease(
    application: RegisteredApplication,
    taskId: string,
    leaseToken: number,
    effectiveRevision: number
  ) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const catalog = await queryRunner.manager
        .createQueryBuilder()
        .select('application.catalog_revision', 'catalogRevision')
        .from('ota_applications', 'application')
        .setLock('pessimistic_read')
        .where('application.app_name = :appName', {
          appName: application.appName
        })
        .getRawOne<{ catalogRevision: number | string }>()
      if (Number(catalog?.catalogRevision) !== effectiveRevision) {
        await queryRunner.commitTransaction()
        throw new Error('Publish catalog revision changed')
      }
      const now = new Date()
      const renewal = await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.publishTask)
        .set({
          lease_until: new Date(now.getTime() + 300_000),
          updated_at: now
        })
        .where(
          'task_id = :taskId AND status = :status AND lease_token = :leaseToken AND lease_until > :now',
          { taskId, status: 'running', leaseToken, now }
        )
        .execute()
      await queryRunner.commitTransaction()
      return Boolean(renewal.affected)
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      throw error
    } finally {
      await queryRunner.release()
    }
  }

  private async recoverTasks() {
    if (this.configService.get('PUBLISH_TASKS_PAUSED') === 'true') {
      return
    }
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
            await this.execute(application, task.taskId)
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
}
