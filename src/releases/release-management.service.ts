import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationWriteAudit,
  withAuditedApplicationWrite
} from '@/audit/application-write-audit'
import { ReleaseWriteRepository } from './ports/release-write.repository'
import { apiUtil } from '@/utils/api'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { mapStoredReleaseRecord } from './release-record.mapper'
import { normalizeReleaseAudience } from './release-audience'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { PublishTaskWorkerService } from '@/jobs/publish/publish-task-worker.service'
import { ReleaseScope } from '@/contracts/releases'
import { ReleaseScopeType } from '@/contracts/release-values'
import {
  ChangeReleaseScopeDto,
  ReleaseListQueryDto,
  ReplaceReleaseUsersDto
} from '@/releases/release-management.dto'

import { ReleaseOperationContext } from '@/contracts/release-operation'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'
import {
  AudienceChange,
  AudienceSnapshot,
  planAudienceChange
} from '@/audit/audience-change'
import { insertReleaseSuccessAudit } from '@/audit/release-success-audit'

type PolicyMutation = {
  action: 'publish' | 'enable' | 'disable' | 'audience_changed' | 'redispatch'
  expectedRevision?: number
  changeSummary: NonNullable<ApplicationWriteAudit['changeSummary']>
  mutate: (
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    release: Record<string, unknown>
  ) => Promise<void | AudienceChange>
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
    private readonly catalog: ReleaseCatalogService,
    private readonly taskWorker: PublishTaskWorkerService,
    private readonly releaseWrites: ReleaseWriteRepository
  ) {}

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
        .where('version.app_name = :appName', { appName })
        .getRawOne<{ total: string | number }>()
      const records = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(application.tables.version, 'version')
        .where('version.app_name = :appName', { appName })
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
          .andWhere('version.app_name = :appName', { appName })
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
    const changeSummary = { userCount: body.userIds.length }
    return this.mutatePolicy(appName, releaseId, context, {
      action: 'audience_changed',
      expectedRevision: body.expectedRevision,
      changeSummary,
      mutate: async (queryRunner, application, release) => {
        let normalized: ReturnType<typeof normalizeReleaseAudience>
        try {
          normalized = normalizeReleaseAudience({
            appName,
            platforms: mapStoredReleaseRecord(release).platforms,
            releaseScope: 'allowlist',
            userIds: body.userIds
          })
        } catch {
          throw new BadRequestException('Release audience is invalid')
        }
        changeSummary.userCount = normalized.userIds.length
        const before = await this.readAudience(
          queryRunner,
          application,
          releaseId,
          release
        )
        const audience = planAudienceChange(before, {
          ...before,
          userIds: normalized.userIds
        })
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
            .into(application.tables.releaseUser, [
              'release_id',
              'user_id',
              'created_at'
            ])
            .values(
              normalized.userIds.map(userId => ({
                release_id: releaseId,
                user_id: userId,
                created_at: new Date()
              }))
            )
            .execute()
        }
        return audience
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
      mutate: async (queryRunner, application, release) => {
        const before = await this.readAudience(
          queryRunner,
          application,
          releaseId,
          release
        )
        const audience = planAudienceChange(before, {
          scope: body.releaseScope,
          userIds:
            body.releaseScope === ReleaseScopeType.Public ? [] : before.userIds
        })
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
        return audience
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
        await this.releaseWrites.setEnabled(
          queryRunner,
          application,
          releaseId,
          enabled
        )
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

  private async mutatePolicy(
    appName: string,
    releaseId: string,
    context: ReleaseOperationContext,
    mutation: PolicyMutation
  ) {
    const application = await this.applications.requireReady(appName)
    const operationId = randomUUID()
    const taskId = randomUUID()
    let revisionAfter = 0
    await withAuditedApplicationWrite(
      this.dataSource,
      application,
      {
        operationId,
        context,
        releaseId,
        action: mutation.action,
        targetType: 'release',
        changeSummary: mutation.changeSummary
      },
      async queryRunner => {
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
        const audience = await mutation.mutate(
          queryRunner,
          application,
          release
        )
        revisionAfter = revisionBefore + 1
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.version)
          .set({ policy_revision: revisionAfter, updated_at: new Date() })
          .where('release_id = :releaseId', { releaseId })
          .execute()
        const catalogRevision =
          await this.applications.incrementCatalogRevision(queryRunner, appName)
        await this.insertTask(queryRunner, application, {
          taskId,
          operationId,
          releaseId,
          action: mutation.action,
          revision: catalogRevision
        })
        await insertReleaseSuccessAudit(queryRunner, application, {
          context,
          taskId,
          operationId,
          releaseId,
          action: mutation.action,
          revisionBefore,
          revisionAfter,
          changeSummary: mutation.changeSummary,
          audience: audience || undefined
        })
      }
    )

    this.catalog.invalidate(appName)
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
    const audit: ApplicationWriteAudit = {
      operationId: randomUUID(),
      context,
      releaseId,
      action: 'audience_changed',
      targetType: 'release',
      changeSummary:
        'userIds' in mutation
          ? { userCount: mutation.userIds.length }
          : { releaseScope: mutation.releaseScope }
    }
    return withAuditedApplicationWrite(
      this.dataSource,
      application,
      audit,
      async queryRunner => {
        if (!(await queryRunner.hasTable(application.tables.releaseDraft))) {
          return null
        }
        const draft = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.releaseDraft, 'draft')
          .setLock('pessimistic_write')
          .where('draft.release_id = :releaseId', { releaseId })
          .andWhere('draft.status = :status', { status: 'draft' })
          .getRawOne<AudienceDraftRecord>()
        if (!draft) {
          return null
        }
        audit.action = 'draft_audience_changed'
        audit.targetType = 'release_draft'

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
        let normalized: ReturnType<typeof normalizeReleaseAudience>
        try {
          normalized = normalizeReleaseAudience({
            appName,
            platforms,
            releaseScope: nextScope,
            userIds: nextUserIds
          })
        } catch {
          throw new BadRequestException('Release audience is invalid')
        }
        const audience = planAudienceChange(
          {
            scope: draft.release_scope as ReleaseScope,
            userIds: currentUserIds
          },
          { scope: normalized.releaseScope, userIds: normalized.userIds }
        )
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
        await insertReleaseSuccessAudit(queryRunner, application, {
          context,
          operationId: audit.operationId,
          releaseId,
          action: 'draft_audience_changed',
          targetType: 'release_draft',
          changeSummary: {
            releaseScope: normalized.releaseScope,
            userCount: normalized.userIds.length
          },
          audience,
          now: updatedAt
        })
        return apiUtil.data({
          releaseId,
          releaseScope: normalized.releaseScope,
          userIds: normalized.userIds,
          status: 'draft'
        })
      }
    )
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
        .andWhere('version.app_name = :appName', { appName })
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
      .andWhere('version.app_name = :appName', { appName: application.appName })
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

  private async readAudience(
    runner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string,
    release: Record<string, unknown>
  ): Promise<AudienceSnapshot> {
    const rows = await runner.manager
      .createQueryBuilder()
      .select('audience.user_id', 'userId')
      .from(application.tables.releaseUser, 'audience')
      .where('audience.release_id = :releaseId', { releaseId })
      .setLock('pessimistic_write')
      .limit(MAX_RELEASE_USERS + 1)
      .getRawMany<{ userId: string }>()
    return {
      scope: (release.release_scope ?? 'public') as ReleaseScope,
      userIds: rows.map(row => row.userId)
    }
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
      policyRevision: Number(release.policyRevision) || 1,
      installerSourceUrl: release.installerSourceUrl,
      bundleUrl: release.bundleUrl,
      releaseNotes: release.releaseNotes,
      artifactSizeBytes: release.artifactSizeBytes,
      createdAt: release.createdAt
    }
  }
}
