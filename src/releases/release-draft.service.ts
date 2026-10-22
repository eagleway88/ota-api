import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { apiUtil } from '@/utils/api'
import { ReleaseScopeType, UpdateType } from '@/contracts/release-values'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { normalizeReleaseAudience } from './release-audience'
import { mapStoredReleaseRecord } from './release-record.mapper'
import { ReleaseOperationContext } from '@/contracts/release-operation'
import { ReleaseCatalogListQueryDto } from '@/releases/release-management.dto'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import {
  ApplicationWriteAudit,
  withAuditedApplicationWrite
} from '@/audit/application-write-audit'
import { ReleaseWriteRepository } from './ports/release-write.repository'
import { planAudienceChange } from '@/audit/audience-change'
import { insertReleaseSuccessAudit } from '@/audit/release-success-audit'
import { draftChangedFields, sameDraftContent } from './draft-audit'
import {
  CreateReleaseDraftDto,
  UpdateReleaseDraftDto
} from '@/releases/release-draft.dto'

type StoredArtifact = {
  artifact_id: string
  url: string
  size_bytes: number | string
  status: string
}

type StoredDraft = {
  release_id: string
  payload: unknown
  release_scope: string
  user_ids: unknown
  status: string
  published_sequence?: number | string | null
  idempotency_key?: string | null
  created_at: Date | string
  updated_at: Date | string
}

@Injectable()
export class ReleaseDraftService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationRegistryService,
    private readonly catalog: ReleaseCatalogService,
    private readonly releaseWrites: ReleaseWriteRepository
  ) {}

  async createDraft(
    appName: string,
    body: CreateReleaseDraftDto,
    idempotencyKey: string | undefined,
    context: ReleaseOperationContext
  ) {
    const application = await this.applications.prepare(appName, context)
    const audit: ApplicationWriteAudit = {
      operationId: randomUUID(),
      context,
      releaseId: randomUUID(),
      action: 'draft_created',
      targetType: 'release_draft'
    }
    return withAuditedApplicationWrite(
      this.dataSource,
      application,
      audit,
      async queryRunner => {
        if (idempotencyKey && idempotencyKey.length > 191) {
          throw new BadRequestException('Idempotency key is too long')
        }
        const normalized = this.normalizeDraft(appName, body)
        const serializedPayload = JSON.stringify(normalized)
        if (idempotencyKey) {
          const existing = await queryRunner.manager
            .createQueryBuilder()
            .select('*')
            .from(application.tables.releaseDraft, 'draft')
            .where('draft.idempotency_key = :idempotencyKey', {
              idempotencyKey
            })
            .setLock('pessimistic_write')
            .getRawOne<StoredDraft>()
          if (existing) {
            audit.releaseId = existing.release_id
            if (
              !sameDraftContent(this.parseJson(existing.payload), normalized)
            ) {
              throw new ConflictException(
                'Idempotency key was already used with different content'
              )
            }
            return apiUtil.data(this.toDraft(existing))
          }
        }
        const releaseId = audit.releaseId
        const audience = planAudienceChange(
          { scope: null, userIds: [] },
          { scope: normalized.releaseScope, userIds: normalized.userIds }
        )
        const now = new Date()
        await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(application.tables.releaseDraft)
          .values({
            release_id: releaseId,
            payload: serializedPayload,
            release_scope: normalized.releaseScope,
            user_ids: JSON.stringify(normalized.userIds),
            status: 'draft',
            idempotency_key: idempotencyKey,
            created_at: now,
            updated_at: now
          })
          .execute()
        await insertReleaseSuccessAudit(queryRunner, application, {
          ...audit,
          changeSummary: { changedFields: draftChangedFields({}, normalized) },
          audience,
          now
        })
        return apiUtil.data({
          releaseId,
          ...normalized,
          status: 'draft',
          releaseSequence: null,
          createdAt: now,
          updatedAt: now
        })
      }
    )
  }

  async list(appName: string, query: ReleaseCatalogListQueryDto) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const page = Math.max(Number(query.page) || 1, 1)
      const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
      const offset = (page - 1) * pageSize
      const includePublished = !query.status || query.status === 'published'
      const includeDraft = !query.status || query.status === 'draft'
      const hasPublished =
        includePublished &&
        (await queryRunner.hasTable(application.tables.version))
      const hasDraft =
        includeDraft &&
        (await queryRunner.hasTable(application.tables.releaseDraft))
      const keyQueries: string[] = []
      const keyParameters: unknown[] = []
      let total = 0

      if (hasPublished) {
        const count = await queryRunner.manager
          .createQueryBuilder()
          .select('COUNT(*)', 'total')
          .from(application.tables.version, 'version')
          .where('version.name = :appName', { appName })
          .getRawOne<{ total: string | number }>()
        total += Number(count?.total ?? 0)
        keyQueries.push(
          `SELECT 'published' AS record_kind, release_id AS record_key, ` +
            `COALESCE(updated_at, created_at, create_time) AS sort_time ` +
            `FROM \`${application.tables.version}\` WHERE name = ?`
        )
        keyParameters.push(appName)
      }
      if (hasDraft) {
        const count = await queryRunner.manager
          .createQueryBuilder()
          .select('COUNT(*)', 'total')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.status = :status', { status: 'draft' })
          .getRawOne<{ total: string | number }>()
        total += Number(count?.total ?? 0)
        keyQueries.push(
          `SELECT 'draft' AS record_kind, release_id AS record_key, updated_at AS sort_time ` +
            `FROM \`${application.tables.releaseDraft}\` WHERE status = 'draft'`
        )
      }
      if (!keyQueries.length || offset >= total) {
        return apiUtil.page([], total)
      }

      const keys = (await queryRunner.query(
        `SELECT record_kind, record_key FROM (${keyQueries.join(
          ' UNION ALL '
        )}) AS release_catalog ` +
          'ORDER BY sort_time DESC, record_key DESC LIMIT ? OFFSET ?',
        [...keyParameters, pageSize, offset]
      )) as Array<{ record_kind: 'draft' | 'published'; record_key: string }>
      const publishedIds = keys
        .filter(key => key.record_kind === 'published')
        .map(key => key.record_key)
      const draftIds = keys
        .filter(key => key.record_kind === 'draft')
        .map(key => key.record_key)
      const entries = new Map<string, Record<string, unknown>>()

      if (publishedIds.length) {
        const records = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.version, 'version')
          .where('version.release_id IN (:...releaseIds)', {
            releaseIds: publishedIds
          })
          .getRawMany<Record<string, unknown>>()
        for (const record of records) {
          entries.set(
            `published:${String(record.release_id)}`,
            this.toPublished(record)
          )
        }
      }
      if (draftIds.length) {
        const drafts = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.release_id IN (:...releaseIds)', {
            releaseIds: draftIds
          })
          .getRawMany<StoredDraft>()
        for (const draft of drafts) {
          entries.set(`draft:${draft.release_id}`, this.toDraft(draft))
        }
      }

      return apiUtil.page(
        keys
          .map(key => entries.get(`${key.record_kind}:${key.record_key}`))
          .filter((entry): entry is Record<string, unknown> => !!entry),
        total
      )
    } finally {
      await queryRunner.release()
    }
  }

  async updateDraft(
    appName: string,
    releaseId: string,
    body: UpdateReleaseDraftDto,
    context: ReleaseOperationContext
  ) {
    const application = await this.applications.prepare(appName, context)
    const audit: ApplicationWriteAudit = {
      operationId: randomUUID(),
      context,
      releaseId,
      action: 'draft_updated',
      targetType: 'release_draft'
    }
    return withAuditedApplicationWrite(
      this.dataSource,
      application,
      audit,
      async queryRunner => {
        const draft = await this.lockDraft(queryRunner, application, releaseId)
        if (draft.status !== 'draft') {
          throw new ConflictException(
            'Published releases cannot be edited as drafts'
          )
        }
        const current = this.parseDraftPayload(draft.payload)
        const currentUserIds = this.parseStoredUserIds(draft.user_ids)
        if (
          draft.release_scope !== String(current.releaseScope) ||
          !sameDraftContent(currentUserIds, current.userIds)
        ) {
          throw new ConflictException('Stored draft audience columns disagree')
        }
        const normalized = this.normalizeDraft(appName, { ...current, ...body })
        const audience = planAudienceChange(
          {
            scope: current.releaseScope,
            userIds: currentUserIds
          },
          { scope: normalized.releaseScope, userIds: normalized.userIds }
        )
        const now = new Date()
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.releaseDraft)
          .set({
            payload: JSON.stringify(normalized),
            release_scope: normalized.releaseScope,
            user_ids: JSON.stringify(normalized.userIds),
            updated_at: now
          })
          .where('release_id = :releaseId', { releaseId })
          .execute()
        await insertReleaseSuccessAudit(queryRunner, application, {
          ...audit,
          changeSummary: {
            changedFields: draftChangedFields(current, normalized)
          },
          audience,
          now
        })
        return apiUtil.data({
          releaseId,
          ...normalized,
          status: 'draft',
          releaseSequence: null,
          createdAt: draft.created_at,
          updatedAt: now
        })
      }
    )
  }

  async detail(appName: string, releaseId: string) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      if (await queryRunner.hasTable(application.tables.version)) {
        const published = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.version, 'version')
          .where('version.release_id = :releaseId', { releaseId })
          .getRawOne<Record<string, unknown>>()
        if (published) {
          return apiUtil.data(this.toPublished(published))
        }
      }
      if (await queryRunner.hasTable(application.tables.releaseDraft)) {
        const draft = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.release_id = :releaseId', { releaseId })
          .getRawOne<StoredDraft>()
        if (draft) {
          return apiUtil.data(this.toDraft(draft))
        }
      }
      throw new NotFoundException('Release or draft does not exist')
    } finally {
      await queryRunner.release()
    }
  }

  async publish(
    appName: string,
    releaseId: string,
    context: ReleaseOperationContext
  ) {
    const application = await this.applications.prepare(appName, context)
    const operationId = randomUUID()
    const taskId = randomUUID()
    const result = await withAuditedApplicationWrite(
      this.dataSource,
      application,
      {
        operationId,
        context,
        releaseId,
        action: 'publish',
        targetType: 'release',
        changeSummary: { source: 'v2' }
      },
      async queryRunner => {
        const draft = await this.lockDraft(queryRunner, application, releaseId)
        if (draft.status === 'published' && draft.published_sequence) {
          return apiUtil.data({
            releaseId,
            releaseSequence: Number(draft.published_sequence),
            status: 'published'
          })
        }
        if (draft.status !== 'draft') {
          throw new ConflictException('Draft is not publishable')
        }

        const payload = this.parseDraftPayload(draft.payload)
        const audience = planAudienceChange(
          { scope: null, userIds: [] },
          { scope: payload.releaseScope, userIds: payload.userIds }
        )
        const artifact = payload.artifactId
          ? await this.lockArtifact(
              queryRunner,
              application,
              payload.artifactId
            )
          : undefined
        const urls = this.releaseUrls(payload, artifact)
        const now = new Date()
        const { releaseSequence } = await this.releaseWrites.insert(
          queryRunner,
          application,
          {
            ...payload,
            ...urls,
            appName,
            releaseId,
            sourceIp: context.sourceIp,
            artifactSizeBytes: artifact
              ? Number(artifact.size_bytes)
              : payload.artifactSizeBytes,
            architectures: payload.architectures ?? [],
            enabled: payload.enabled ?? true,
            mandatory: payload.mandatory ?? true,
            showUpdateDialog: payload.showUpdateDialog ?? true,
            createdAt: now
          }
        )
        if (payload.userIds.length) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(application.tables.releaseUser, [
              'release_id',
              'user_id',
              'created_at'
            ])
            .values(
              payload.userIds.map(userId => ({
                release_id: releaseId,
                user_id: userId,
                created_at: now
              }))
            )
            .execute()
        }
        if (artifact) {
          await queryRunner.manager
            .createQueryBuilder()
            .update(application.tables.artifact)
            .set({ status: 'published', updated_at: now })
            .where('artifact_id = :artifactId', {
              artifactId: artifact.artifact_id
            })
            .execute()
        }
        await queryRunner.manager
          .createQueryBuilder()
          .update(application.tables.releaseDraft)
          .set({
            status: 'published',
            published_sequence: releaseSequence,
            updated_at: now
          })
          .where('release_id = :releaseId', { releaseId })
          .execute()
        const catalogRevision =
          await this.applications.incrementCatalogRevision(
            queryRunner,
            appName,
            now
          )
        await this.insertPublishTask(
          queryRunner,
          application,
          taskId,
          operationId,
          releaseId,
          catalogRevision,
          now
        )
        await insertReleaseSuccessAudit(queryRunner, application, {
          taskId,
          operationId,
          releaseId,
          action: 'publish',
          revisionBefore: 0,
          revisionAfter: 1,
          changeSummary: { releaseSequence },
          audience,
          context,
          now
        })
        return apiUtil.data({
          releaseId,
          releaseSequence,
          taskId,
          operationId,
          status: 'published'
        })
      }
    )
    this.catalog.invalidate(appName)
    return result
  }

  private normalizeDraft(
    appName: string,
    body: CreateReleaseDraftDto
  ): CreateReleaseDraftDto {
    const platforms = Array.from(new Set(body.platforms))
    const architectures = Array.from(new Set(body.architectures ?? []))
    const compatibleBaseVersionCodes = Array.from(
      new Set(body.compatibleBaseVersionCodes)
    )
    let audience: ReturnType<typeof normalizeReleaseAudience>
    try {
      audience = normalizeReleaseAudience({
        appName,
        platforms: platforms.join(','),
        releaseScope: body.releaseScope,
        userIds: body.userIds
      })
    } catch {
      throw new BadRequestException('Release audience is invalid')
    }
    if (
      body.updateType === UpdateType.Hot &&
      !compatibleBaseVersionCodes.length
    ) {
      throw new BadRequestException(
        'Hot updates require compatibleBaseVersionCodes'
      )
    }
    if (!body.artifactId && !body.installerSourceUrl && !body.bundleUrl) {
      throw new BadRequestException('A release artifact or URL is required')
    }
    return {
      ...body,
      platforms,
      architectures,
      compatibleBaseVersionCodes,
      userIds: audience.userIds,
      releaseScope: audience.releaseScope as ReleaseScopeType
    }
  }

  private releaseUrls(
    payload: CreateReleaseDraftDto,
    artifact?: StoredArtifact
  ) {
    const artifactUrl = artifact?.url
    if (payload.updateType === UpdateType.Full) {
      const installerSourceUrl = payload.installerSourceUrl ?? artifactUrl
      if (!installerSourceUrl) {
        throw new BadRequestException('Full updates require an installer URL')
      }
      return { installerSourceUrl, bundleUrl: payload.bundleUrl }
    }
    const bundleUrl = payload.bundleUrl ?? artifactUrl
    if (!bundleUrl) {
      throw new BadRequestException('Hot updates require a bundle URL')
    }
    return { installerSourceUrl: payload.installerSourceUrl, bundleUrl }
  }

  private async lockDraft(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string
  ) {
    const draft = await queryRunner.manager
      .createQueryBuilder()
      .select('*')
      .from(application.tables.releaseDraft, 'draft')
      .setLock('pessimistic_write')
      .where('draft.release_id = :releaseId', { releaseId })
      .getRawOne<StoredDraft>()
    if (!draft) {
      throw new NotFoundException('Release draft does not exist')
    }
    return draft
  }

  private async lockArtifact(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    artifactId: string
  ) {
    const artifact = await queryRunner.manager
      .createQueryBuilder()
      .select('*')
      .from(application.tables.artifact, 'artifact')
      .setLock('pessimistic_write')
      .where('artifact.artifact_id = :artifactId', { artifactId })
      .getRawOne<StoredArtifact>()
    if (!artifact || !['pending', 'published'].includes(artifact.status)) {
      throw new BadRequestException('Release artifact is unavailable')
    }
    return artifact
  }

  private async insertPublishTask(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    taskId: string,
    operationId: string,
    releaseId: string,
    catalogRevision: number,
    now: Date
  ) {
    await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.publishTask)
      .values({
        task_id: taskId,
        operation_id: operationId,
        release_id: releaseId,
        action: 'publish',
        requested_revision: catalogRevision,
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

  private parseDraftPayload(value: unknown) {
    const parsed = this.parseJson(value)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Stored release draft payload is invalid')
    }
    return parsed as unknown as CreateReleaseDraftDto
  }

  private parseStoredUserIds(value: unknown): string[] {
    const parsed = this.parseJson(value)
    if (
      !Array.isArray(parsed) ||
      !parsed.every((id: unknown) => typeof id === 'string')
    ) {
      throw new ConflictException('Stored draft audience is invalid')
    }
    return parsed
  }

  private parseJson(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value
    }
    try {
      return JSON.parse(value) as unknown
    } catch {
      return null
    }
  }

  private toDraft(draft: StoredDraft) {
    return {
      releaseId: draft.release_id,
      ...this.parseDraftPayload(draft.payload),
      status: draft.status,
      releaseSequence: draft.published_sequence
        ? Number(draft.published_sequence)
        : null,
      createdAt: draft.created_at,
      updatedAt: draft.updated_at
    }
  }

  private toPublished(record: Record<string, unknown>) {
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
      releaseNotes:
        release.legacyPayload.releaseNotes ?? release.legacyPayload.desc,
      artifactSizeBytes:
        release.legacyPayload.artifactSizeBytes ??
        release.legacyPayload.fileSize,
      installerSourceUrl:
        release.legacyPayload.installerSourceUrl ??
        release.legacyPayload.installUrl,
      bundleUrl:
        release.legacyPayload.bundleUrl ?? release.legacyPayload.packageUrl,
      policyRevision: Number(release.legacyPayload.policyRevision) || 1,
      status: release.enabled ? 'published' : 'disabled',
      createdAt:
        release.legacyPayload.createdAt ?? release.legacyPayload.createTime
    }
  }
}
