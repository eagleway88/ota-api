import { ConflictException, Injectable, Optional } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner, Table } from 'typeorm'
import { Request } from 'express'
import { createHash, randomUUID } from 'crypto'
import { apiUtil } from '@/utils/api'
import { ConfigService } from '@nestjs/config'
import { UpdaterUtil } from '@/utils/updater'
import { OtaVersionQueryService } from './ota-version-query.service'
import { createAppErrorLogTable, createErrorTable } from '@/utils/version'
import { createSuccessTable, createVersionTable } from '@/utils/version'
import { createReleaseUserTable } from '@/utils/version'
import { calculateNextReleaseSequence } from '@/utils/version'
import { normalizeVersionList, normalizeVersionValue } from '@/utils/version'
import {
  fetchIP,
  humpToUnderline,
  isRequestIpAllowed,
  underlineToHump
} from '@/utils'
import { AppErrorLogDto, CheckDto, CreateDto } from './version.dto'
import { ErrorDto, SuccessDto, UpdateType, UploadDto } from './version.dto'
import { VersionListItemDto, VersionListQueryDto } from './version.dto'
import { otaUploadMaxBytes, validateOtaUpload } from './upload-policy'
import { userIdMatchesContext } from '@/contracts/user-id'
import { normalizeLegacyReleaseAudience } from '@/compat/legacy/http/release-audience.mapper'
import { serializeLegacyReleaseRecord } from '@/compat/legacy/mappers/release.mapper'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ReleaseManagementService } from '@/releases/release-management.service'

@Injectable()
export class VersionService {
  private updater?: UpdaterUtil
  constructor(
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly configService: ConfigService,
    @InjectDataSource() private dataSource: DataSource,
    @Optional()
    private readonly applications?: ApplicationRegistryService,
    @Optional()
    private readonly releaseManagement?: ReleaseManagementService
  ) {
    this.updater = new UpdaterUtil(this.configService)
  }

  async list(req: Request, name: string, query: VersionListQueryDto) {
    if (!isRequestIpAllowed(req, this.configService.get<string>('IPS'))) {
      return apiUtil.error('Permission denied')
    }

    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()

    try {
      const tablePrefix = await this.resolveTablePrefix(name)
      const versionTableName = createVersionTable(tablePrefix).name
      const physicalTablePrefix = versionTableName.slice(0, -'_version'.length)
      const tables = await queryRunner.getTables([
        versionTableName,
        `${physicalTablePrefix}_success`,
        `${physicalTablePrefix}_error`
      ])
      const tableNames = new Set(tables.map(table => table.name))
      const versionTable = tables.find(table => table.name === versionTableName)
      if (!versionTable) {
        return apiUtil.page([], 0)
      }

      const { records, total } = await this.queryVersionTable(
        queryRunner,
        versionTable,
        name,
        query
      )
      const successCounts = await this.queryVersionStatusCounts(
        queryRunner,
        `${physicalTablePrefix}_success`,
        tableNames
      )
      const errorCounts = await this.queryVersionStatusCounts(
        queryRunner,
        `${physicalTablePrefix}_error`,
        tableNames
      )
      const versions: VersionListItemDto[] = records.map(record => {
        const normalized = underlineToHump(record) as Record<string, unknown>
        return {
          ...normalized,
          successCount: successCounts.get(Number(record.id)) ?? 0,
          errorCount: errorCounts.get(Number(record.id)) ?? 0
        } as unknown as VersionListItemDto
      })

      versions.sort((left, right) => {
        const timeDiff =
          this.toTimestamp(right.createTime) - this.toTimestamp(left.createTime)
        return timeDiff || Number(right.id) - Number(left.id)
      })

      return apiUtil.page(versions, total)
    } finally {
      await queryRunner.release()
    }
  }

  async create(req: Request, body: CreateDto) {
    const audience = this.normalizeReleaseAudience(body)
    const createTime = new Date()
    const targetVersionCode = normalizeVersionValue(body.ver) ?? body.ver
    const created = await this.insertPublishedVersion(
      createVersionTable(await this.resolveTablePrefix(body.name)),
      {
        ...body,
        releaseId: randomUUID(),
        releaseScope: audience.releaseScope,
        policyRevision: 1,
        ver: targetVersionCode,
        targetVersionCode,
        baseVersions: normalizeVersionList(body.baseVersions),
        compatibleBaseVersionCodes: this.legacyCompatibleVersionCodes(
          targetVersionCode,
          body.baseVersions
        ),
        releaseNotes: body.desc,
        artifactSizeBytes: body.fileSize,
        isEnabled: body.enable ?? 1,
        isMandatory: body.mandatory ?? 1,
        showUpdateDialog: body.showDialog ?? 1,
        installerSourceUrl: body.installUrl,
        bundleUrl: body.packageUrl,
        platforms: this.stringList(body.platform),
        architectures: this.stringList(body.architecture),
        distributionChannel: body.channel,
        updateType: UpdateType.Full,
        ip: fetchIP(req),
        createTime,
        createdAt: createTime
      },
      audience.userIds
    )

    if (created) {
      this.otaVersionQueryService.invalidate(body.name)
    }

    return apiUtil.data(serializeLegacyReleaseRecord(created))
  }

  async check(body: CheckDto) {
    const normalizedVer =
      typeof body.ver === 'string'
        ? (normalizeVersionValue(body.ver) ??
          Number(body.ver.replaceAll('.', '')))
        : body.ver

    // 兼容旧版
    if (typeof body.ver === 'string') {
      body.ver = normalizedVer
    }

    if (
      body.userId &&
      !userIdMatchesContext(body.userId, body.name, body.platform)
    ) {
      return apiUtil.error('Invalid userId for application or platform')
    }

    return apiUtil.data(
      await this.otaVersionQueryService.findLatestAvailableVersion({
        name: body.name,
        channel: body.channel,
        architecture: body.architecture,
        platform: body.platform,
        ver: normalizedVer,
        id: body.id,
        userIds: body.userId ? [body.userId] : undefined
      })
    )
  }

  async upload(req: Request, file: Express.Multer.File, body: UploadDto) {
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

    const normalizedVer = normalizeVersionValue(body.ver)
    const audience = this.normalizeReleaseAudience(body)
    const createTime = new Date()
    const dir = `${body.name}/${body.ver}`
    const uploadRes = await this.updater?.put(dir, file)
    if (!uploadRes || uploadRes.err || !uploadRes.url) {
      return apiUtil.error(uploadRes?.err || 'Upload failed')
    }

    const created = await this.insertPublishedVersion(
      createVersionTable(await this.resolveTablePrefix(body.name)),
      {
        ...body,
        releaseId: randomUUID(),
        releaseScope: audience.releaseScope,
        policyRevision: 1,
        ver: normalizedVer ?? body.ver,
        targetVersionCode: normalizedVer ?? body.ver,
        baseVersions: normalizeVersionList(body.baseVersions),
        compatibleBaseVersionCodes: this.legacyCompatibleVersionCodes(
          normalizedVer ?? body.ver,
          body.baseVersions
        ),
        releaseNotes: body.desc,
        fileSize: file.size,
        artifactSizeBytes: file.size,
        isEnabled: body.enable ?? 1,
        isMandatory: body.mandatory ?? 1,
        showUpdateDialog: body.showDialog ?? 1,
        packageUrl: uploadRes.url,
        bundleUrl: uploadRes.url,
        installerSourceUrl: body.installUrl,
        platforms: this.stringList(body.platform),
        architectures: this.stringList(body.architecture),
        distributionChannel: body.channel,
        updateType: UpdateType.Hot,
        ip: fetchIP(req),
        createTime,
        createdAt: createTime
      },
      audience.userIds
    )
    if (created) {
      this.otaVersionQueryService.invalidate(body.name)
    }
    return apiUtil.data(serializeLegacyReleaseRecord(created))
  }

  async success(req: Request, body: SuccessDto) {
    await this.assertVersionExists(body.name, body.verId)

    const createTime = new Date()
    const created = await this.insertStatusReport(
      createSuccessTable(await this.resolveTablePrefix(body.name)),
      {
        ...body,
        releaseSequence: body.verId,
        reportedUsername: body.username,
        extras: this.normalizeExtras(body.extras),
        ip: fetchIP(req),
        createTime,
        createdAt: createTime
      },
      body.reportId
    )

    return apiUtil.data(this.serializeLegacyStatusRecord(created))
  }

  async error(req: Request, body: ErrorDto) {
    await this.assertVersionExists(body.name, body.verId)

    const now = new Date()
    if (body.id) {
      const updated = await this.updateDynamicTable(
        createErrorTable(await this.resolveTablePrefix(body.name)),
        body.id,
        {
          ...body,
          releaseSequence: body.verId,
          reportedUsername: body.username,
          extras: this.normalizeExtras(body.extras),
          ip: fetchIP(req),
          updateTime: now,
          updatedAt: now
        }
      )

      return apiUtil.data(this.serializeLegacyStatusRecord(updated))
    }

    const created = await this.insertStatusReport(
      createErrorTable(await this.resolveTablePrefix(body.name)),
      {
        ...body,
        releaseSequence: body.verId,
        reportedUsername: body.username,
        extras: this.normalizeExtras(body.extras),
        ip: fetchIP(req),
        updateTime: now,
        createTime: now,
        updatedAt: now,
        createdAt: now
      },
      body.reportId
    )

    return apiUtil.data(this.serializeLegacyStatusRecord(created))
  }

  async appError(req: Request, body: AppErrorLogDto) {
    const table = createAppErrorLogTable(
      await this.resolveTablePrefix(body.name)
    )
    const queryRunner = this.dataSource.createQueryRunner()
    let errorLockName: string | undefined
    let errorLockAcquired = false

    await queryRunner.connect()

    try {
      await this.assertPreparedTable(queryRunner, table.name)

      const now = new Date()
      const extras = this.normalizeExtras(body.extras)
      const errorHash = this.buildAppErrorHash(body)
      errorLockName = `ota_app_error_${errorHash}`
      const lockRows = (await queryRunner.query(
        'SELECT GET_LOCK(?, 10) AS acquired',
        [errorLockName]
      )) as Array<{ acquired: number | string }>
      errorLockAcquired = Number(lockRows[0]?.acquired) === 1
      if (!errorLockAcquired) {
        throw new ConflictException('Error report aggregation is busy')
      }
      const existing = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, table.name)
        .where('error_hash = :errorHash', { errorHash })
        .getRawOne<Record<string, unknown>>()

      if (existing) {
        const existingId = Number(existing.id)
        if (!Number.isSafeInteger(existingId)) {
          throw new Error('Stored application error ID is invalid')
        }
        const updatePayload = this.prepareDynamicPayload(table, {
          ip: fetchIP(req),
          extras,
          username: body.username,
          reportedUsername: body.username,
          updateTime: now,
          updatedAt: now
        })

        await queryRunner.manager
          .createQueryBuilder()
          .update(table.name)
          .set(updatePayload)
          .where('id = :id', { id: existingId })
          .execute()

        await queryRunner.manager.increment(
          table.name,
          { id: existingId },
          'report_count',
          1
        )

        const updated = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(table.name, table.name)
          .where('id = :id', { id: existingId })
          .getRawOne<Record<string, unknown>>()

        return apiUtil.data(
          this.serializeLegacyStatusRecord(
            this.normalizeDynamicResult(table, updated ?? existing)
          )
        )
      }

      const created = await this.insertIntoDynamicTableByQueryRunner(
        queryRunner,
        table,
        {
          ...body,
          reportedUsername: body.username,
          extras,
          errorHash,
          reportCount: 1,
          ip: fetchIP(req),
          updateTime: now,
          createTime: now,
          updatedAt: now,
          createdAt: now
        }
      )

      return apiUtil.data(this.serializeLegacyStatusRecord(created))
    } finally {
      if (errorLockAcquired && errorLockName) {
        await queryRunner.query('SELECT RELEASE_LOCK(?)', [errorLockName])
      }
      await queryRunner.release()
    }
  }

  private async assertVersionExists(name: string, id: number) {
    const table = createVersionTable(await this.resolveTablePrefix(name))
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return apiUtil.error('Version does not exist')
      }

      const version = await queryRunner.manager
        .createQueryBuilder()
        .select('id')
        .from(table.name, 'version')
        .where('id = :id', { id })
        .getRawOne<{ id: number | string }>()

      if (!version) {
        return apiUtil.error('Version does not exist')
      }
    } finally {
      await queryRunner.release()
    }
  }

  private async queryVersionTable(
    queryRunner: QueryRunner,
    table: Table,
    name: string,
    query: VersionListQueryDto
  ) {
    const columnNames = new Set(table.columns.map(column => column.name))
    const builder = queryRunner.manager
      .createQueryBuilder()
      .from(table.name, 'version')

    builder.andWhere('version.name = :name', { name })
    if (query.id) {
      builder.andWhere('version.id = :id', { id: Number(query.id) })
    }
    if (query.ver) {
      builder.andWhere('version.ver = :ver', {
        ver: normalizeVersionValue(query.ver)
      })
    }
    if (query.platform) {
      builder.andWhere(
        "FIND_IN_SET(:platform, REPLACE(version.platform, ' ', '')) > 0",
        { platform: query.platform }
      )
    }
    if (query.architecture) {
      if (!columnNames.has('architecture')) {
        return { records: [], total: 0 }
      }
      builder.andWhere(
        "FIND_IN_SET(:architecture, REPLACE(version.architecture, ' ', '')) > 0",
        { architecture: query.architecture }
      )
    }
    if (query.channel) {
      if (!columnNames.has('channel')) {
        return { records: [], total: 0 }
      }
      builder.andWhere('version.channel = :channel', {
        channel: query.channel
      })
    }
    if (query.updateType) {
      if (columnNames.has('update_type')) {
        builder.andWhere('version.update_type = :updateType', {
          updateType: query.updateType
        })
      } else {
        const urlColumn =
          query.updateType === UpdateType.Full ? 'install_url' : 'package_url'
        if (!columnNames.has(urlColumn)) {
          return { records: [], total: 0 }
        }
        builder.andWhere(`version.${urlColumn} IS NOT NULL`)
        builder.andWhere(`version.${urlColumn} <> ''`)
      }
    }

    const booleanFilters = [
      ['enable', query.enable],
      ['mandatory', query.mandatory],
      ['show_dialog', query.showDialog]
    ] as const
    for (const [columnName, value] of booleanFilters) {
      if (value === undefined) {
        continue
      }
      if (!columnNames.has(columnName)) {
        return { records: [], total: 0 }
      }
      builder.andWhere(`version.${columnName} = :${columnName}`, {
        [columnName]: Number(value)
      })
    }

    const page = query.page ?? 1
    const pageSize = query.pageSize ?? 20
    const countResult = await builder
      .select('COUNT(*)', 'total')
      .getRawOne<{ total: string | number }>()
    const total = Number(countResult?.total ?? 0)

    builder.select('version.*')
    if (columnNames.has('create_time')) {
      builder.orderBy('version.create_time', 'DESC')
    }
    builder.addOrderBy('version.id', 'DESC')

    const records = await builder
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getRawMany<Record<string, unknown>>()

    return { records, total }
  }

  private async queryVersionStatusCounts(
    queryRunner: QueryRunner,
    tableName: string,
    tableNames: Set<string>
  ) {
    const counts = new Map<number, number>()
    if (!tableNames.has(tableName)) {
      return counts
    }

    const records = await queryRunner.manager
      .createQueryBuilder()
      .select('status.ver_id', 'verId')
      .addSelect('COUNT(*)', 'count')
      .from(tableName, 'status')
      .groupBy('status.ver_id')
      .getRawMany<{ verId: string | number; count: string | number }>()

    for (const record of records) {
      counts.set(Number(record.verId), Number(record.count))
    }
    return counts
  }

  private toTimestamp(value?: Date | string) {
    if (!value) {
      return 0
    }
    const timestamp = new Date(value).getTime()
    return Number.isNaN(timestamp) ? 0 : timestamp
  }

  private async insertIntoDynamicTable(
    table: Table,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      await this.assertPreparedTable(queryRunner, table.name)
      return await this.insertIntoDynamicTableByQueryRunner(
        queryRunner,
        table,
        payload
      )
    } finally {
      await queryRunner.release()
    }
  }

  private async insertStatusReport(
    table: Table,
    payload: Record<string, unknown>,
    reportId?: string
  ): Promise<Record<string, unknown>> {
    if (reportId) {
      const queryRunner = this.dataSource.createQueryRunner()
      await queryRunner.connect()
      try {
        await this.assertPreparedTable(queryRunner, table.name)
        const insertPayload = this.prepareDynamicPayload(table, payload)
        await queryRunner.manager
          .createQueryBuilder()
          .insert()
          .into(table.name)
          .values(insertPayload)
          .orIgnore()
          .execute()
        const existing = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(table.name, 'report')
          .where('report.report_id = :reportId', { reportId })
          .getRawOne<Record<string, unknown>>()
        if (existing) {
          return this.normalizeDynamicResult(table, existing)
        }
        throw new Error('Idempotent status report was not persisted')
      } finally {
        await queryRunner.release()
      }
    }
    return this.insertIntoDynamicTable(table, payload)
  }

  private async insertPublishedVersion(
    table: Table,
    payload: Record<string, unknown>,
    userIds: readonly string[]
  ): Promise<Record<string, unknown>> {
    const appName = String(payload.name)
    const operationContext = {
      requestId: randomUUID(),
      sourceIp: typeof payload.ip === 'string' ? payload.ip : undefined
    }
    const application = this.applications
      ? await this.applications.prepare(appName, operationContext)
      : undefined
    if (application) {
      table = createVersionTable(application.tablePrefix)
    }
    const queryRunner = this.dataSource.createQueryRunner()
    const audienceTable = createReleaseUserTable(
      application?.tablePrefix ?? appName
    )
    let created: Record<string, unknown> | undefined
    await queryRunner.connect()

    try {
      await this.ensureTable(queryRunner, table)
      await this.ensureTable(queryRunner, audienceTable)
      await queryRunner.startTransaction()
      try {
        created = await this.insertIntoDynamicTableByQueryRunner(
          queryRunner,
          table,
          payload
        )
        const releaseId = String(created.releaseId)
        if (userIds.length) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(audienceTable.name)
            .values(
              userIds.map(userId => ({
                release_id: releaseId,
                user_id: userId,
                created_at: new Date()
              }))
            )
            .execute()
        }
        if (application && this.releaseManagement) {
          await this.releaseManagement.enqueuePublishedRelease(
            queryRunner,
            application,
            releaseId,
            operationContext
          )
        }
        await queryRunner.commitTransaction()
      } catch (error) {
        await queryRunner.rollbackTransaction()
        throw error
      }
      if (!created) {
        throw new Error('Published release was not created')
      }
      return created
    } finally {
      await queryRunner.release()
    }
  }

  private async insertIntoDynamicTableByQueryRunner(
    queryRunner: QueryRunner,
    table: Table,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const insertPayload = this.prepareDynamicPayload(table, payload)
    const insertRes = await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(table.name)
      .values(insertPayload)
      .execute()

    const identifier = insertRes.identifiers[0] as
      Record<string, unknown> | undefined
    const rawResult: unknown = insertRes.raw
    const rawInsertId =
      rawResult && typeof rawResult === 'object' && 'insertId' in rawResult
        ? (rawResult as { insertId?: unknown }).insertId
        : undefined
    const insertId = Number(identifier?.id ?? rawInsertId)
    if (!Number.isSafeInteger(insertId) || insertId < 1) {
      return apiUtil.error('Insert data failed')
    }

    const created = await queryRunner.manager
      .createQueryBuilder()
      .select('*')
      .from(table.name, table.name)
      .where('id = :id', { id: insertId })
      .getRawOne<Record<string, unknown>>()

    return this.normalizeDynamicResult(
      table,
      created ?? { id: insertId, ...insertPayload }
    )
  }

  private async updateDynamicTable(
    table: Table,
    id: number,
    payload: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return apiUtil.error('Error record does not exist')
      }

      const updatePayload = this.prepareDynamicPayload(table, {
        ...payload,
        id: undefined
      })
      const updateRes = await queryRunner.manager
        .createQueryBuilder()
        .update(table.name)
        .set(updatePayload)
        .where('id = :id', { id })
        .execute()

      if (!updateRes.affected) {
        return apiUtil.error('Error record does not exist')
      }

      const updated = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, table.name)
        .where('id = :id', { id })
        .getRawOne<Record<string, unknown>>()

      return this.normalizeDynamicResult(
        table,
        updated ?? { id, ...updatePayload }
      )
    } finally {
      await queryRunner.release()
    }
  }

  private async ensureTable(queryRunner: QueryRunner, table: Table) {
    const hasTable = await queryRunner.hasTable(table.name)
    if (!hasTable) {
      await queryRunner.createTable(table, true)

      if (table.name.endsWith('_version')) {
        await this.ensureVersionTableAutoIncrement(queryRunner, table.name)
      }

      return
    }

    await this.syncTableColumns(queryRunner, table)
    if (table.name.endsWith('_version')) {
      await this.ensureVersionTableAutoIncrement(queryRunner, table.name)
    }
  }

  private async assertPreparedTable(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    if (!(await queryRunner.hasTable(tableName))) {
      throw new Error(`Application schema is not ready: ${tableName}`)
    }
  }

  private async syncTableColumns(queryRunner: QueryRunner, table: Table) {
    const currentTable = await queryRunner.getTable(table.name)
    if (!currentTable) {
      return
    }

    const missingColumns = table.columns.filter(column => {
      return !currentTable.columns.find(current => current.name === column.name)
    })

    if (!missingColumns.length) {
      return
    }

    await queryRunner.addColumns(table.name, missingColumns)

    if (
      table.name.endsWith('_version') &&
      missingColumns.some(column => column.name === 'update_type')
    ) {
      await this.backfillVersionUpdateType(queryRunner, table.name)
    }

    if (
      table.name.endsWith('_version') &&
      missingColumns.some(column => column.name === 'show_dialog')
    ) {
      await this.backfillVersionShowDialog(queryRunner, table.name)
    }

    if (
      table.name.endsWith('_version') &&
      missingColumns.some(column =>
        ['release_id', 'release_scope', 'policy_revision'].includes(column.name)
      )
    ) {
      await this.backfillVersionReleaseMetadata(queryRunner, table.name)
    }

    if (
      table.name.endsWith('_error_log') &&
      missingColumns.some(column =>
        ['error_hash', 'report_count', 'update_time'].includes(column.name)
      )
    ) {
      await this.backfillAppErrorLogColumns(queryRunner, table.name)
    }
  }

  private async backfillVersionUpdateType(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    await queryRunner.query(
      `UPDATE ${tableName}
       SET update_type = CASE
         WHEN install_url IS NOT NULL AND install_url <> '' THEN 'full'
         WHEN package_url IS NOT NULL AND package_url <> '' THEN 'hot'
         ELSE update_type
       END
       WHERE update_type IS NULL OR update_type = ''`
    )
  }

  private async backfillVersionShowDialog(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    await queryRunner.query(
      `UPDATE ${tableName}
       SET show_dialog = 1
       WHERE show_dialog IS NULL`
    )
  }

  private async backfillVersionReleaseMetadata(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    await queryRunner.query(
      `UPDATE \`${tableName}\`
       SET release_id = UUID()
       WHERE release_id IS NULL OR release_id = ''`
    )
    await queryRunner.query(
      `UPDATE \`${tableName}\`
       SET release_scope = 'public'
       WHERE release_scope IS NULL OR release_scope = ''`
    )
    await queryRunner.query(
      `UPDATE \`${tableName}\`
       SET policy_revision = 1
       WHERE policy_revision IS NULL OR policy_revision < 1`
    )
  }

  private async backfillAppErrorLogColumns(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    await queryRunner.query(
      `UPDATE ${tableName}
       SET error_hash = MD5(CONCAT_WS('|',
         IFNULL(name, ''),
         IFNULL(platform, ''),
         IFNULL(CAST(ver AS CHAR), ''),
         IFNULL(kind, ''),
         IFNULL(message, ''),
         IFNULL(stack, '')
       ))
       WHERE error_hash IS NULL OR error_hash = ''`
    )

    await queryRunner.query(
      `UPDATE ${tableName}
       SET report_count = 1
       WHERE report_count IS NULL OR report_count <= 0`
    )

    await queryRunner.query(
      `UPDATE ${tableName}
       SET update_time = create_time
       WHERE update_time IS NULL`
    )
  }

  private async ensureVersionTableAutoIncrement(
    queryRunner: QueryRunner,
    tableName: string
  ) {
    const tableStatus = (await queryRunner.query(
      `SELECT AUTO_INCREMENT AS autoIncrement
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tableName]
    )) as Array<{ autoIncrement?: number | string | null }>
    const maximumRows = (await queryRunner.query(
      `SELECT MAX(id) AS maximumId FROM \`${tableName}\``
    )) as Array<{ maximumId?: number | string | null }>
    const nextSequence = calculateNextReleaseSequence(
      Number(tableStatus[0]?.autoIncrement),
      Number(maximumRows[0]?.maximumId)
    )
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` AUTO_INCREMENT = ${nextSequence}`
    )
  }

  private compactObject(payload: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    )
  }

  private prepareDynamicPayload(
    table: Table,
    payload: Record<string, unknown>
  ) {
    const compactedPayload = this.compactObject(
      humpToUnderline(payload) as Record<string, unknown>
    )
    const columnNames = new Set(table.columns.map(column => column.name))
    const jsonColumnNames = new Set(
      table.columns
        .filter(column => column.type === 'json')
        .map(column => column.name)
    )

    return Object.fromEntries(
      Object.entries(compactedPayload)
        .filter(([key]) => columnNames.has(key))
        .map(([key, value]) => {
          if (!jsonColumnNames.has(key)) {
            return [key, value]
          }

          return [key, this.stringifyJsonColumnValue(value)]
        })
    )
  }

  private normalizeReleaseAudience(body: CreateDto | UploadDto) {
    try {
      return normalizeLegacyReleaseAudience({
        appName: body.name,
        platforms: body.platform,
        releaseScope: body.releaseScope,
        userIds: body.userIds
      })
    } catch (error) {
      return apiUtil.error(
        error instanceof Error ? error.message : 'Invalid release audience'
      )
    }
  }

  private async resolveTablePrefix(appName: string) {
    const application = this.applications
      ? await this.applications.resolve(appName)
      : undefined
    return application?.tablePrefix ?? appName
  }

  private stringList(value?: string) {
    if (!value) {
      return []
    }
    return Array.from(
      new Set(
        value
          .split(',')
          .map(item => item.trim())
          .filter(Boolean)
      )
    )
  }

  private versionCodeList(value?: string) {
    return this.stringList(value)
      .map(item => normalizeVersionValue(item))
      .filter((item): item is number => item !== undefined)
  }

  private legacyCompatibleVersionCodes(
    targetVersionCode: number | string,
    value?: string
  ) {
    const target = normalizeVersionValue(targetVersionCode)
    return Array.from(
      new Set([
        ...(target === undefined ? [] : [target]),
        ...this.versionCodeList(value)
      ])
    )
  }

  private normalizeDynamicResult(
    table: Table,
    record: Record<string, unknown>
  ): Record<string, unknown> {
    const jsonColumnNames = new Set(
      table.columns
        .filter(column => column.type === 'json')
        .map(column => column.name)
    )

    const normalizedRecord = Object.fromEntries(
      Object.entries(record).map(([key, value]) => {
        if (!jsonColumnNames.has(key)) {
          return [key, value]
        }

        return [key, this.parseJsonColumnValue(value)]
      })
    )

    return underlineToHump(normalizedRecord) as Record<string, unknown>
  }

  private stringifyJsonColumnValue(value: unknown) {
    if (value === undefined) return value
    if (value === null) return null

    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value) as unknown)
      } catch {
        return JSON.stringify(value)
      }
    }

    return JSON.stringify(value)
  }

  private parseJsonColumnValue(value: unknown): unknown {
    if (typeof value !== 'string') {
      return value
    }

    try {
      return JSON.parse(value) as unknown
    } catch {
      return value
    }
  }

  private normalizeExtras(extras?: string) {
    if (!extras) return undefined

    return extras
  }

  private serializeLegacyStatusRecord(record: Record<string, unknown>) {
    const fields = [
      'id',
      'name',
      'platform',
      'ver',
      'verId',
      'ip',
      'extras',
      'username',
      'message',
      'kind',
      'stack',
      'errorHash',
      'reportCount',
      'updateTime',
      'createTime'
    ]
    return Object.fromEntries(
      fields
        .filter(field => record[field] !== undefined)
        .map(field => [field, record[field]])
    )
  }

  private buildAppErrorHash(body: AppErrorLogDto) {
    const segments = [
      body.name,
      body.platform,
      String(body.ver),
      body.kind,
      body.message,
      body.stack ?? ''
    ]

    return createHash('md5')
      .update(
        segments
          .map(segment => this.normalizeErrorHashSegment(segment))
          .join('|')
      )
      .digest('hex')
  }

  private normalizeErrorHashSegment(value: string) {
    return value.replace(/\r\n/g, '\n').trim()
  }
}
