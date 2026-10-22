import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'

@Injectable()
export class RetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name)
  private timer?: NodeJS.Timeout
  private running = false

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly applications: ApplicationRegistryService
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000)
    this.timer.unref()
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer)
    }
  }

  async run() {
    if (this.running) {
      return
    }
    this.running = true
    try {
      // Independent of application tables; expiry is enforced at request time, not by this job.
      await this.dataSource.query(`DELETE FROM ota_admin_sessions
        WHERE expires_at <= UTC_TIMESTAMP(3) OR revoked_at IS NOT NULL LIMIT 500`)
      const taskCutoff = this.cutoff('TASK_RETENTION_DAYS', 90)
      const auditCutoff = this.cutoff('AUDIT_RETENTION_DAYS', 180)
      for (const application of await this.applications.listReady()) {
        await this.cleanApplication(application, taskCutoff, auditCutoff)
      }
      await this.cleanGlobalAudit(auditCutoff)
    } catch (error) {
      this.logger.error(
        'Retention cleanup failed',
        error instanceof Error ? error.stack : undefined
      )
    } finally {
      this.running = false
    }
  }

  private async cleanApplication(
    application: RegisteredApplication,
    taskCutoff: Date,
    auditCutoff: Date
  ) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const tasks = await queryRunner.manager
        .createQueryBuilder()
        .select('task.task_id', 'taskId')
        .from(application.tables.publishTask, 'task')
        .where('task.status = :status', { status: 'succeeded' })
        .andWhere('task.finished_at < :cutoff', { cutoff: taskCutoff })
        .orderBy('task.finished_at', 'ASC')
        .take(500)
        .getRawMany<{ taskId: string }>()
      const taskIds = tasks.map(task => task.taskId)
      if (taskIds.length) {
        await queryRunner.startTransaction()
        try {
          await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(application.tables.publishTaskLog)
            .where('task_id IN (:...taskIds)', { taskIds })
            .execute()
          await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(application.tables.publishTask)
            .where('task_id IN (:...taskIds)', { taskIds })
            .andWhere('status = :status', { status: 'succeeded' })
            .execute()
          await queryRunner.commitTransaction()
          this.logger.log(
            `retention app=${application.appName} succeededTasks=${taskIds.length}`
          )
        } catch (error) {
          await queryRunner.rollbackTransaction()
          throw error
        }
      }
      await this.deleteOldAuditBatch(
        queryRunner,
        application.tables.auditLog,
        auditCutoff
      )
    } finally {
      await queryRunner.release()
    }
  }

  private async cleanGlobalAudit(cutoff: Date) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (await queryRunner.hasTable('ota_admin_audit_log')) {
        await this.deleteOldAuditBatch(
          queryRunner,
          'ota_admin_audit_log',
          cutoff
        )
      }
    } finally {
      await queryRunner.release()
    }
  }

  private async deleteOldAuditBatch(
    queryRunner: QueryRunner,
    tableName: string,
    cutoff: Date
  ) {
    const rows = await queryRunner.manager
      .createQueryBuilder()
      .select('audit.audit_id', 'auditId')
      .from(tableName, 'audit')
      .where('audit.created_at < :cutoff', { cutoff })
      .orderBy('audit.created_at', 'ASC')
      .take(500)
      .getRawMany<{ auditId: string }>()
    const auditIds = rows.map(row => row.auditId)
    if (auditIds.length) {
      await queryRunner.manager
        .createQueryBuilder()
        .delete()
        .from(tableName)
        .where('audit_id IN (:...auditIds)', { auditIds })
        .execute()
      this.logger.log(
        `retention auditTable=${tableName} auditRows=${auditIds.length}`
      )
    }
  }

  private cutoff(configKey: string, defaultDays: number) {
    const days = Number(this.configService.get(configKey) ?? defaultDays)
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  }
}
