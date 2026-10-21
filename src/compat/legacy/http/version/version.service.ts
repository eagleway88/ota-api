import { Injectable, Optional } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner, Table } from 'typeorm'
import { Request } from 'express'
import { randomUUID } from 'crypto'
import { apiUtil } from '@/utils/api'
import { ConfigService } from '@nestjs/config'
import { OssArtifactStorage } from '@/artifacts/oss-artifact.storage'
import { OtaVersionQueryService } from './ota-version-query.service'
import { createVersionTable } from '@/utils/version'
import { normalizeVersionValue } from '@/utils/version'
import { fetchIP, isRequestIpAllowed, underlineToHump } from '@/utils'
import { AppErrorLogDto, CheckDto, CreateDto } from './version.dto'
import { ErrorDto, SuccessDto, UpdateType, UploadDto } from './version.dto'
import { VersionListItemDto, VersionListQueryDto } from './version.dto'
import { otaUploadMaxBytes, validateOtaUpload } from '@/artifacts/upload-policy'
import { userIdMatchesContext } from '@/contracts/user-id'
import { normalizeLegacyReleaseAudience } from '@/compat/legacy/http/release-audience.mapper'
import { serializeLegacyReleaseRecord } from '@/compat/legacy/mappers/release.mapper'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ReleaseManagementService } from '@/releases/release-management.service'
import { withApplicationWrite } from '@/infrastructure/persistence/application-write-transaction'
import { DualWriteReleaseRepository } from '@/compat/legacy/persistence/dual-write-release.repository'

import { TelemetryWriteService } from '@/telemetry/telemetry-write.service'
import {
  legacySuccessReport,
  legacyFailureReport,
  legacyApplicationError,
  serializeLegacyReport
} from './telemetry.mapper'

@Injectable()
export class VersionService {
  private updater?: OssArtifactStorage
  constructor(
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly configService: ConfigService,
    @InjectDataSource() private dataSource: DataSource,
    @Optional()
    private readonly applications?: ApplicationRegistryService,
    @Optional()
    private readonly releaseManagement?: ReleaseManagementService,
    @Optional()
    private readonly releaseWrites?: DualWriteReleaseRepository,
    @Optional() private readonly telemetryWrites?: TelemetryWriteService
  ) {
    this.updater = new OssArtifactStorage(this.configService)
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
    const created = await this.insertPublishedVersion(
      {
        ...body,
        releaseId: randomUUID(),
        releaseScope: audience.releaseScope,
        updateType: UpdateType.Full,
        ip: fetchIP(req),
        createTime
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

    const audience = this.normalizeReleaseAudience(body)
    const createTime = new Date()
    const dir = `${body.name}/${body.ver}`
    const uploadRes = await this.updater?.put(dir, file)
    if (!uploadRes || uploadRes.err || !uploadRes.url) {
      return apiUtil.error(uploadRes?.err || 'Upload failed')
    }

    const created = await this.insertPublishedVersion(
      {
        ...body,
        releaseId: randomUUID(),
        releaseScope: audience.releaseScope,
        fileSize: file.size,
        packageUrl: uploadRes.url,
        updateType: UpdateType.Hot,
        ip: fetchIP(req),
        createTime
      },
      audience.userIds
    )
    if (created) {
      this.otaVersionQueryService.invalidate(body.name)
    }
    return apiUtil.data(serializeLegacyReleaseRecord(created))
  }

  async success(req: Request, body: SuccessDto) {
    const report = await this.requireTelemetry().success(
      legacySuccessReport(body, fetchIP(req))
    )
    return apiUtil.data(serializeLegacyReport(report))
  }

  async error(req: Request, body: ErrorDto) {
    const report = await this.requireTelemetry().failure(
      legacyFailureReport(body, fetchIP(req))
    )
    return apiUtil.data(serializeLegacyReport(report))
  }

  async appError(req: Request, body: AppErrorLogDto) {
    const report = await this.requireTelemetry().applicationError(
      legacyApplicationError(body, fetchIP(req))
    )
    return apiUtil.data(serializeLegacyReport(report))
  }

  private requireTelemetry() {
    if (!this.telemetryWrites)
      throw new Error('Telemetry persistence is not configured')
    return this.telemetryWrites
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

  private async insertPublishedVersion(
    payload: Record<string, unknown>,
    userIds: readonly string[]
  ): Promise<Record<string, unknown>> {
    const appName = String(payload.name)
    const operationContext = {
      requestId: randomUUID(),
      sourceIp: typeof payload.ip === 'string' ? payload.ip : undefined
    }
    if (!this.applications || !this.releaseManagement || !this.releaseWrites)
      throw new Error('Registered publication persistence is not configured')
    const releaseManagement = this.releaseManagement
    const releaseWrites = this.releaseWrites
    const application = await this.applications.prepare(
      appName,
      operationContext
    )
    return withApplicationWrite(
      this.dataSource,
      application,
      async queryRunner => {
        const created = await releaseWrites.insertLegacy(
          queryRunner,
          application,
          payload
        )
        const releaseId = String(created.releaseId)
        if (userIds.length) {
          await queryRunner.manager
            .createQueryBuilder()
            .insert()
            .into(application.tables.releaseUser)
            .values(
              userIds.map(userId => ({
                release_id: releaseId,
                user_id: userId,
                created_at: new Date()
              }))
            )
            .execute()
        }
        await releaseManagement.enqueuePublishedRelease(
          queryRunner,
          application,
          releaseId,
          operationContext
        )
        return created
      }
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
    return application ? { tablePrefix: application.tablePrefix } : appName
  }
}
