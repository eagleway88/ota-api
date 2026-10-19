import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import { apiUtil } from '@/utils/api'
import { UpdaterUtil } from '@/utils/updater'
import {
  otaUploadMaxBytes,
  validateOtaUpload
} from '@/api/version/upload-policy'
import { ReleaseScopeType, UpdateType } from '@/api/version/version.dto'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { RegisteredApplication } from '@/applications/application-registry.service'
import { normalizeLegacyReleaseAudience } from '@/compat/legacy/http/release-audience.mapper'
import { mapLegacyReleaseRecord } from '@/compat/legacy/mappers/release.mapper'
import { ReleaseOperationContext } from './release-management.service'
import { ReleaseListQueryDto } from './release-management.dto'
import {
  CreateReleaseDraftDto,
  UpdateReleaseDraftDto
} from './release-draft.dto'

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
  private readonly updater: UpdaterUtil

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly applications: ApplicationRegistryService
  ) {
    this.updater = new UpdaterUtil(configService)
  }

  async uploadArtifact(appName: string, file?: Express.Multer.File) {
    if (!file) {
      return apiUtil.error('File is required')
    }
    const uploadError = validateOtaUpload(
      file,
      otaUploadMaxBytes(this.configService.get('OTA_UPLOAD_MAX_BYTES'))
    )
    if (uploadError) {
      return apiUtil.error(uploadError)
    }

    const application = await this.applications.prepare(appName)
    const artifactId = randomUUID()
    const checksumSha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex')
    const uploaded = await this.updater.put(
      `${appName}/artifacts/${artifactId}`,
      file
    )
    if (!uploaded.url || uploaded.err) {
      return apiUtil.error(uploaded.err || 'Upload failed')
    }
    const storageKey = this.storageKey(uploaded.url)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const now = new Date()
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(application.tables.artifact)
        .values({
          artifact_id: artifactId,
          storage_key: storageKey,
          url: uploaded.url,
          size_bytes: file.size,
          checksum_sha256: checksumSha256,
          status: 'pending',
          created_at: now,
          updated_at: now
        })
        .execute()
      return apiUtil.data({
        artifactId,
        url: uploaded.url,
        sizeBytes: file.size,
        checksumSha256,
        status: 'pending'
      })
    } finally {
      await queryRunner.release()
    }
  }

  async createDraft(
    appName: string,
    body: CreateReleaseDraftDto,
    idempotencyKey?: string
  ) {
    if (idempotencyKey && idempotencyKey.length > 191) {
      throw new BadRequestException('Idempotency key is too long')
    }
    const application = await this.applications.prepare(appName)
    const normalized = this.normalizeDraft(appName, body)
    const serializedPayload = JSON.stringify(normalized)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    const lockName = idempotencyKey
      ? `ota_draft_${createHash('sha256')
          .update(`${appName}:${idempotencyKey}`)
          .digest('hex')
          .slice(0, 48)}`
      : undefined
    let lockAcquired = false
    try {
      if (lockName) {
        const lockRows = (await queryRunner.query(
          'SELECT GET_LOCK(?, 10) AS acquired',
          [lockName]
        )) as Array<{ acquired: number | string }>
        lockAcquired = Number(lockRows[0]?.acquired) === 1
        if (!lockAcquired) {
          throw new ConflictException('Draft idempotency key is busy')
        }
      }
      if (idempotencyKey) {
        const existing = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.idempotency_key = :idempotencyKey', { idempotencyKey })
          .getRawOne<StoredDraft>()
        if (existing) {
          if (
            JSON.stringify(this.parseJson(existing.payload)) !==
            serializedPayload
          ) {
            throw new ConflictException(
              'Idempotency key was already used with different content'
            )
          }
          return apiUtil.data(this.toDraft(existing))
        }
      }

      const releaseId = randomUUID()
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
      return apiUtil.data({
        releaseId,
        ...normalized,
        status: 'draft',
        releaseSequence: null,
        createdAt: now,
        updatedAt: now
      })
    } finally {
      if (lockAcquired && lockName) {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [lockName])
      }
      await queryRunner.release()
    }
  }

  async list(appName: string, query: ReleaseListQueryDto) {
    const application = await this.applications.resolve(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      const entries: Array<Record<string, unknown>> = []
      if (await queryRunner.hasTable(application.tables.version)) {
        const published = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.version, 'version')
          .where('version.name = :appName', { appName })
          .getRawMany<Record<string, unknown>>()
        entries.push(...published.map(record => this.toPublished(record)))
      }
      if (await queryRunner.hasTable(application.tables.releaseDraft)) {
        const drafts = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(application.tables.releaseDraft, 'draft')
          .where('draft.status = :status', { status: 'draft' })
          .getRawMany<StoredDraft>()
        entries.push(...drafts.map(draft => this.toDraft(draft)))
      }
      entries.sort(
        (left, right) => this.entryTime(right) - this.entryTime(left)
      )
      const page = Math.max(Number(query.page) || 1, 1)
      const pageSize = Math.min(Math.max(Number(query.pageSize) || 20, 1), 100)
      const offset = (page - 1) * pageSize
      return apiUtil.page(
        entries.slice(offset, offset + pageSize),
        entries.length
      )
    } finally {
      await queryRunner.release()
    }
  }

  async updateDraft(
    appName: string,
    releaseId: string,
    body: UpdateReleaseDraftDto
  ) {
    const application = await this.applications.prepare(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const draft = await this.lockDraft(queryRunner, application, releaseId)
      if (draft.status !== 'draft') {
        throw new ConflictException(
          'Published releases cannot be edited as drafts'
        )
      }
      const current = this.parseDraftPayload(draft.payload)
      const normalized = this.normalizeDraft(appName, { ...current, ...body })
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
      await queryRunner.commitTransaction()
      return apiUtil.data({
        releaseId,
        ...normalized,
        status: 'draft',
        releaseSequence: null,
        createdAt: draft.created_at,
        updatedAt: now
      })
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
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
    const application = await this.applications.prepare(appName)
    const queryRunner = this.dataSource.createQueryRunner()
    const operationId = randomUUID()
    const taskId = randomUUID()
    await queryRunner.connect()
    await queryRunner.startTransaction()
    try {
      const draft = await this.lockDraft(queryRunner, application, releaseId)
      if (draft.status === 'published' && draft.published_sequence) {
        await queryRunner.commitTransaction()
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
      const artifact = payload.artifactId
        ? await this.lockArtifact(queryRunner, application, payload.artifactId)
        : undefined
      const urls = this.releaseUrls(payload, artifact)
      const now = new Date()
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(application.tables.version)
        .values(
          this.releaseInsertValues(
            appName,
            releaseId,
            payload,
            urls,
            artifact,
            now
          )
        )
        .execute()
      const insertedRelease = await queryRunner.manager
        .createQueryBuilder()
        .select('version.id', 'id')
        .from(application.tables.version, 'version')
        .where('version.release_id = :releaseId', { releaseId })
        .getRawOne<{ id: number | string }>()
      const releaseSequence = Number(insertedRelease?.id)
      if (!releaseSequence) {
        throw new Error('Release sequence allocation failed')
      }
      if (payload.userIds.length) {
        await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(application.tables.releaseUser)
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
      await queryRunner.manager
        .createQueryBuilder()
        .update('ota_applications')
        .set({
          catalog_revision: () => 'catalog_revision + 1',
          updated_at: now
        })
        .where('app_name = :appName', { appName })
        .execute()
      await this.insertPublishTask(
        queryRunner,
        application,
        taskId,
        operationId,
        releaseId,
        now
      )
      await this.insertPublishAudit(queryRunner, application, {
        taskId,
        operationId,
        releaseId,
        releaseSequence,
        context,
        now
      })
      await queryRunner.commitTransaction()
      return apiUtil.data({
        releaseId,
        releaseSequence,
        taskId,
        operationId,
        status: 'published'
      })
    } catch (error) {
      await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
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
    const audience = normalizeLegacyReleaseAudience({
      appName,
      platforms: platforms.join(','),
      releaseScope: body.releaseScope,
      userIds: body.userIds
    })
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

  private releaseInsertValues(
    appName: string,
    releaseId: string,
    payload: CreateReleaseDraftDto,
    urls: { installerSourceUrl?: string; bundleUrl?: string },
    artifact: StoredArtifact | undefined,
    now: Date
  ) {
    const enabled = payload.enabled ?? true
    const mandatory = payload.mandatory ?? true
    const showDialog = payload.showUpdateDialog ?? true
    const sizeBytes = artifact
      ? Number(artifact.size_bytes)
      : payload.artifactSizeBytes
    return {
      release_id: releaseId,
      release_scope: payload.releaseScope,
      policy_revision: 1,
      target_version_code: payload.targetVersionCode,
      compatible_base_version_codes: JSON.stringify(
        payload.compatibleBaseVersionCodes
      ),
      release_notes: payload.releaseNotes,
      artifact_size_bytes: sizeBytes,
      is_enabled: enabled ? 1 : 0,
      is_mandatory: mandatory ? 1 : 0,
      show_update_dialog: showDialog ? 1 : 0,
      installer_source_url: urls.installerSourceUrl,
      bundle_url: urls.bundleUrl,
      platforms: JSON.stringify(payload.platforms),
      architectures: JSON.stringify(payload.architectures ?? []),
      distribution_channel: payload.distributionChannel,
      created_at: now,
      name: appName,
      ver: payload.targetVersionCode,
      base_versions: payload.compatibleBaseVersionCodes.join(','),
      desc: payload.releaseNotes,
      file_size: sizeBytes,
      enable: enabled ? 1 : 0,
      mandatory: mandatory ? 1 : 0,
      show_dialog: showDialog ? 1 : 0,
      install_url: urls.installerSourceUrl,
      package_url: urls.bundleUrl,
      update_type: payload.updateType,
      channel: payload.distributionChannel,
      platform: payload.platforms.join(','),
      architecture: (payload.architectures ?? []).join(','),
      create_time: now
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
        requested_revision: 1,
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

  private async insertPublishAudit(
    queryRunner: QueryRunner,
    application: RegisteredApplication,
    input: {
      taskId: string
      operationId: string
      releaseId: string
      releaseSequence: number
      context: ReleaseOperationContext
      now: Date
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
        action: 'publish',
        target_type: 'release',
        target_id: input.releaseId,
        release_id: input.releaseId,
        task_id: input.taskId,
        revision_before: 0,
        revision_after: 1,
        change_summary: JSON.stringify({
          releaseSequence: input.releaseSequence
        }),
        result: 'succeeded',
        request_id: input.context.requestId,
        source_ip: input.context.sourceIp,
        created_at: input.now
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

  private entryTime(entry: Record<string, unknown>) {
    const value = entry.updatedAt ?? entry.createdAt
    if (value instanceof Date) {
      return value.getTime()
    }
    if (typeof value === 'string' || typeof value === 'number') {
      const time = new Date(value).getTime()
      return Number.isNaN(time) ? 0 : time
    }
    return 0
  }

  private storageKey(url: string) {
    try {
      return new URL(url).pathname.replace(/^\//, '')
    } catch {
      return url
    }
  }
}
