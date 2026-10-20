import { Injectable, NotFoundException } from '@nestjs/common'
import { QueryRunner } from 'typeorm'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import {
  adminPage,
  AdminQueryWindow,
  normalizeAdminQuery,
  queryAdminPage
} from '@/infrastructure/persistence/admin-query'
import { TaskLogQueryDto, TaskQueryDto } from './task-query.dto'

@Injectable()
export class TaskQueryService {
  constructor(private readonly read: AdminReadRepository) {}

  list(appName: string, query: TaskQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, app) => {
      const result = await this.listTasks(runner, app, query, window)
      return adminPage(result.rows, result.total, window, this.history())
    })
  }

  detail(appName: string, taskId: string) {
    return this.read.withApplication(appName, async (runner, app) => {
      const task = await this.findTask(runner, app, taskId)
      await this.read.requireTable(runner, app.tables.publishTaskLog)
      const latestLog = await runner.manager
        .createQueryBuilder()
        .select('log.*')
        .from(app.tables.publishTaskLog, 'log')
        .where('log.task_id = :taskId', { taskId })
        .orderBy('log.attempt_no', 'DESC')
        .limit(1)
        .getRawOne<Record<string, unknown>>()
      return { code: 0, data: { task, latestLog: latestLog ?? null } }
    })
  }

  logs(appName: string, taskId: string, query: TaskLogQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, app) => {
      await this.findTask(runner, app, taskId)
      await this.read.requireTable(runner, app.tables.publishTaskLog)
      const filter = runner.manager
        .createQueryBuilder()
        .from(app.tables.publishTaskLog, 'log')
        .where('log.task_id = :taskId', { taskId })
        .andWhere('log.started_at >= :from AND log.started_at < :to', {
          from: window.from,
          to: window.to
        })
      if (query.status)
        filter.andWhere('log.status = :status', { status: query.status })
      const { rows, total } = await queryAdminPage(
        filter,
        'log',
        'log.started_at',
        'log.attempt_no',
        window
      )
      return adminPage(rows, total, window, this.history())
    })
  }

  delivery(appName: string, releaseId: string, query: AdminTimeQueryDto) {
    const window = normalizeAdminQuery(query)
    return this.read.withApplication(appName, async (runner, app) => {
      await this.read.requireTable(runner, app.tables.version)
      const release = await runner.manager
        .createQueryBuilder()
        .select('version.release_id', 'releaseId')
        .from(app.tables.version, 'version')
        .where('version.name = :appName AND version.release_id = :releaseId', {
          appName,
          releaseId
        })
        .getRawOne<{ releaseId: string }>()
      if (!release)
        throw new NotFoundException(
          'Release does not exist in this application'
        )
      const { rows, total } = await this.listTasks(
        runner,
        app,
        { ...query, releaseId },
        window
      )
      const latestLogs = new Map<string, Record<string, unknown>>()
      if (rows.length) {
        await this.read.requireTable(runner, app.tables.publishTaskLog)
        const logs = await runner.manager
          .createQueryBuilder()
          .select('log.*')
          .from(app.tables.publishTaskLog, 'log')
          .where('log.task_id IN (:...taskIds)', {
            taskIds: rows.map(row => row.task_id)
          })
          .andWhere(
            `log.attempt_no = (SELECT MAX(latest.attempt_no) FROM \`${app.tables.publishTaskLog}\` latest WHERE latest.task_id = log.task_id)`
          )
          .getRawMany<Record<string, unknown>>()
        for (const log of logs) latestLogs.set(String(log.task_id), log)
      }
      return {
        code: 0,
        data: {
          releaseId,
          tasks: rows.map(row => ({
            ...row,
            latestLog: latestLogs.get(String(row.task_id)) ?? null
          })),
          total,
          page: window.page,
          pageSize: window.pageSize,
          from: window.from.toISOString(),
          to: window.to.toISOString(),
          receiveConfirmationAvailable: false,
          countSemantics:
            'application-dispatch-attempts-not-release-recipients',
          note: 'A task can dispatch other eligible releases. Counts are neither unique recipients nor installations.',
          ...this.history()
        }
      }
    })
  }

  private async findTask(
    runner: QueryRunner,
    app: RegisteredApplication,
    taskId: string
  ) {
    await this.read.requireTable(runner, app.tables.publishTask)
    const task = await runner.manager
      .createQueryBuilder()
      .select('task.*')
      .from(app.tables.publishTask, 'task')
      .where('task.task_id = :taskId', { taskId })
      .getRawOne<Record<string, unknown>>()
    if (!task)
      throw new NotFoundException(
        'Task does not exist in this application or is past retention'
      )
    return task
  }

  private async listTasks(
    runner: QueryRunner,
    app: RegisteredApplication,
    query: TaskQueryDto,
    window: AdminQueryWindow
  ) {
    await this.read.requireTable(runner, app.tables.publishTask)
    const filter = runner.manager
      .createQueryBuilder()
      .from(app.tables.publishTask, 'task')
      .where('task.created_at >= :from AND task.created_at < :to', {
        from: window.from,
        to: window.to
      })
    if (query.status)
      filter.andWhere('task.status = :status', { status: query.status })
    if (query.releaseId)
      filter.andWhere('task.release_id = :releaseId', {
        releaseId: query.releaseId
      })
    return queryAdminPage(
      filter,
      'task',
      'task.created_at',
      'task.task_id',
      window
    )
  }

  private history() {
    return {
      historyNotice:
        'Records before migration may not have been collected; records beyond retention may have been removed.'
    }
  }
}
