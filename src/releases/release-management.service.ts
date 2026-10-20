import {
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { apiUtil } from '@/utils/api'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { mapStoredReleaseRecord } from './release-record.mapper'
import { normalizeReleaseAudience } from './release-audience'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { PublishTaskWorkerService } from '@/infrastructure/tasks/publish-task-worker.service'
import { ReleaseScope } from '@/contracts/releases'
import { ReleaseScopeType } from '@/api/version/version.dto'
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

type AudienceDraftRecord = {
  release_id: string
  payload: unknown
  release_scope: string
  user_ids: unknown
  status: string
}

type DraftAudienceMutation =
  | { userIds: readonly string[] }
  | {
      releaseScope: ReleaseScope
    }

@Injectable()
export class ReleaseManagementService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationRegistryService,
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly taskWorker: PublishTaskWorkerService
  ) {}

  async prepare(appName: string, context: ReleaseOperationContext) {
    const application = await this.applications.prepare(appName, context)
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
    const catalogRevision = await this.applications.incrementCatalogRevision(
      queryRunner,
      application.appName
    )
    await this.insertTask(queryRunner, application, {
      taskId,
      operationId,
      releaseId,
      action: 'publish',
      revision: catalogRevision
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
    return this.taskWorker.execute(application, taskId, requestId)
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
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (await queryRunner.hasTable(application.tables.version)) {
        const published = await queryRunner.manager
          .createQueryBuilder()
          .select('version.release_id', 'releaseId')
          .from(application.tables.version, 'version')
          .where('version.release_id = :releaseId', { releaseId })
          .andWhere('version.name = :appName', { appName })
          .getRawOne<{ releaseId: string }>()
        if (published) {
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
        }
      }
      if (await queryRunner.hasTable(application.tables.releaseDraft)) {
        const draft = await queryRunner.manager
          .createQueryBuilder()
          .select('draft.user_ids', 'userIds')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.release_id = :releaseId', { releaseId })
          .andWhere('draft.status = :status', { status: 'draft' })
          .getRawOne<{ userIds: unknown }>()
        if (draft) {
          return apiUtil.data(this.parseStoredUserIds(draft.userIds))
        }
      }
      throw new NotFoundException('Release or draft does not exist')
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
    const draftResult = await this.mutateDraftAudience(
      appName,
      releaseId,
      context,
      { userIds: body.userIds }
    )
    if (draftResult) {
      return draftResult
    }
    const normalized = normalizeReleaseAudience({
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
    const draftResult = await this.mutateDraftAudience(
      appName,
      releaseId,
      context,
      { releaseScope: body.releaseScope }
    )
    if (draftResult) {
      return draftResult
    }
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
        if (body.releaseScope === ReleaseScopeType.Public) {
          await queryRunner.manager
            .createQueryBuilder()
            .delete()
            .from(application.tables.releaseUser)
            .where('release_id = :releaseId', { releaseId })
            .execute()
        }
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
    const application = await this.applications.prepare(appName, context)
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
      const catalogRevision = await this.applications.incrementCatalogRevision(
        queryRunner,
        appName
      )
      await this.insertTask(queryRunner, application, {
        taskId,
        operationId,
        releaseId,
        action: mutation.action,
        revision: catalogRevision
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
    await this.taskWorker.execute(application, taskId, context.requestId)
    return apiUtil.data({
      taskId,
      operationId,
      releaseId,
      revision: revisionAfter
    })
  }

  private async mutateDraftAudience(
    appName: string,
    releaseId: string,
    context: ReleaseOperationContext,
    mutation: DraftAudienceMutation
  ) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (!(await queryRunner.hasTable(application.tables.releaseDraft))) {
        return null
      }
      await queryRunner.startTransaction()
      const draft = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.releaseDraft, 'draft')
        .setLock('pessimistic_write')
        .where('draft.release_id = :releaseId', { releaseId })
        .andWhere('draft.status = :status', { status: 'draft' })
        .getRawOne<AudienceDraftRecord>()
      if (!draft) {
        await queryRunner.commitTransaction()
        return null
      }

      const payload = this.parseDraftPayload(draft.payload)
      const platforms = Array.isArray(payload.platforms)
        ? payload.platforms.filter(
            (platform): platform is string => typeof platform === 'string'
          )
        : []
      const currentUserIds = this.parseStoredUserIds(draft.user_ids)
      const currentScope: ReleaseScope =
        draft.release_scope === 'allowlist' ? 'allowlist' : 'public'
      const nextScope =
        'releaseScope' in mutation ? mutation.releaseScope : currentScope
      const nextUserIds =
        'userIds' in mutation
          ? [...mutation.userIds]
          : nextScope === 'public'
            ? []
            : currentUserIds
      const normalized = normalizeReleaseAudience({
        appName,
        platforms: platforms.join(','),
        releaseScope: nextScope,
        userIds: nextUserIds
      })
      const updatedAt = new Date()
      await queryRunner.manager
        .createQueryBuilder()
        .update(application.tables.releaseDraft)
        .set({
          payload: JSON.stringify({
            ...payload,
            releaseScope: normalized.releaseScope,
            userIds: normalized.userIds
          }),
          release_scope: normalized.releaseScope,
          user_ids: JSON.stringify(normalized.userIds),
          updated_at: updatedAt
        })
        .where('release_id = :releaseId', { releaseId })
        .execute()
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(application.tables.auditLog)
        .values({
          audit_id: randomUUID(),
          operation_id: randomUUID(),
          part_no: 1,
          actor_type: 'admin',
          actor_admin_id: context.actorAdminId,
          actor_name_snapshot: context.actorName,
          action: 'draft_audience_changed',
          target_type: 'release_draft',
          target_id: releaseId,
          release_id: releaseId,
          task_id: null,
          revision_before: null,
          revision_after: null,
          change_summary: JSON.stringify({
            releaseScope: normalized.releaseScope,
            userCount: normalized.userIds.length
          }),
          result: 'succeeded',
          request_id: context.requestId,
          source_ip: context.sourceIp,
          created_at: updatedAt
        })
        .execute()
      await queryRunner.commitTransaction()
      return apiUtil.data({
        releaseId,
        releaseScope: normalized.releaseScope,
        userIds: normalized.userIds,
        status: 'draft'
      })
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction()
      }
      throw error
    } finally {
      await queryRunner.release()
    }
  }

  private parseStoredUserIds(value: unknown) {
    const parsed = this.parseJson(value)
    if (
      !Array.isArray(parsed) ||
      !parsed.every(item => typeof item === 'string')
    ) {
      throw new Error('Stored release draft userIds are invalid')
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  }

  private parseDraftPayload(value: unknown) {
    const parsed = this.parseJson(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored release draft payload is invalid')
    }
    return parsed as Record<string, unknown>
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') return value
    try {
      return JSON.parse(value) as unknown
    } catch {
      throw new Error('Stored release draft JSON is invalid')
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
    const release = mapStoredReleaseRecord(record)
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
