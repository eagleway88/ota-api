
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner, Table } from 'typeorm'
import { Request } from 'express'
import { createHash } from 'crypto'
import { apiUtil } from '@/utils/api'
import { ConfigService } from '@nestjs/config'
import { UpdaterUtil } from '@/utils/updater'
import { OtaVersionQueryService } from './ota-version-query.service'
import { createAppErrorLogTable, createErrorTable, } from '@/utils/version'
import { createSuccessTable, createVersionTable, } from '@/utils/version'
import { VERSION_TABLE_AUTO_INCREMENT_START } from '@/utils/version'
import { fetchIP, humpToUnderline, underlineToHump } from '@/utils'
import { AppErrorLogDto, CheckDto, CreateDto, } from './version.dto'
import { ErrorDto, SuccessDto, UpdateType, UploadDto } from './version.dto'
import { WsService } from '@/ws/ws.service'

@Injectable()
export class VersionService {
  private updater?: UpdaterUtil
  constructor(
    private readonly wsService: WsService,
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly configService: ConfigService,
    @InjectDataSource() private dataSource: DataSource,
  ) {
    this.updater = new UpdaterUtil(this.configService)
  }

  async create(req: Request, body: CreateDto) {
    const created = await this.insertIntoDynamicTable(createVersionTable(body.name), {
      ...body,
      updateType: UpdateType.Full,
      ip: fetchIP(req),
      createTime: new Date()
    })

    if (created) await this.wsService.sendOtaNameMessage(body.name, created)

    return apiUtil.data(created)
  }

  async check(body: CheckDto) {
    const table = createVersionTable(body.name)
    const queryRunner = this.dataSource.createQueryRunner()

    // 兼容旧版
    if (typeof body.ver === 'string') {
      body.ver = Number(body.ver.replaceAll('.', ''))
    }

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return apiUtil.data(null)
      }

      await this.syncTableColumns(queryRunner, table)
    } finally {
      await queryRunner.release()
    }

    return apiUtil.data(await this.otaVersionQueryService.findLatestAvailableVersion({
      name: body.name,
      channel: body.channel,
      platform: body.platform,
      ver: body.ver,
      id: body.id
    }))
  }

  async upload(req: Request, file: any, body: UploadDto) {
    if (!file) {
      return apiUtil.error('File is required')
    }

    const dir = `${body.name}/${body.ver}`
    const uploadRes = await this.updater?.put(dir, file)
    if (!uploadRes || uploadRes.err || !uploadRes.url) {
      return apiUtil.error(uploadRes?.err || 'Upload failed')
    }

    const created = await this.insertIntoDynamicTable(createVersionTable(body.name), {
      ...body,
      fileSize: file.size,
      packageUrl: uploadRes.url,
      updateType: UpdateType.Hot,
      ip: fetchIP(req),
      createTime: new Date()
    })
    if (created) await this.wsService.sendOtaNameMessage(body.name, created)
    return apiUtil.data(created)

  }

  async success(req: Request, body: SuccessDto) {
    await this.assertVersionExists(body.name, body.verId)

    const created = await this.insertIntoDynamicTable(createSuccessTable(body.name), {
      ...body,
      extras: this.normalizeExtras(body.extras),
      ip: fetchIP(req),
      createTime: new Date()
    })

    return apiUtil.data(created)

  }

  async error(req: Request, body: ErrorDto) {
    await this.assertVersionExists(body.name, body.verId)

    const now = new Date()
    if (body.id) {
      const updated = await this.updateDynamicTable(createErrorTable(body.name), body.id, {
        ...body,
        extras: this.normalizeExtras(body.extras),
        ip: fetchIP(req),
        updateTime: now
      })

      return apiUtil.data(updated)
    }

    const created = await this.insertIntoDynamicTable(createErrorTable(body.name), {
      ...body,
      extras: this.normalizeExtras(body.extras),
      ip: fetchIP(req),
      updateTime: now,
      createTime: now
    })

    return apiUtil.data(created)

  }

  async appError(req: Request, body: AppErrorLogDto) {
    const table = createAppErrorLogTable(body.name)
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      await this.ensureTable(queryRunner, table)

      const now = new Date()
      const extras = this.normalizeExtras(body.extras)
      const errorHash = this.buildAppErrorHash(body)
      const existing = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, table.name)
        .where('error_hash = :errorHash', { errorHash })
        .getRawOne()

      if (existing) {
        const updatePayload = this.prepareDynamicPayload(table, {
          ip: fetchIP(req),
          extras,
          username: body.username,
          updateTime: now
        })

        await queryRunner.manager
          .createQueryBuilder()
          .update(table.name)
          .set(updatePayload)
          .where('id = :id', { id: existing.id })
          .execute()

        await queryRunner.manager.increment(table.name, { id: existing.id }, 'report_count', 1)

        const updated = await queryRunner.manager
          .createQueryBuilder()
          .select('*')
          .from(table.name, table.name)
          .where('id = :id', { id: existing.id })
          .getRawOne()

        return apiUtil.data(this.normalizeDynamicResult(table, updated ?? existing))
      }

      const created = await this.insertIntoDynamicTableByQueryRunner(queryRunner, table, {
        ...body,
        extras,
        errorHash,
        reportCount: 1,
        ip: fetchIP(req),
        updateTime: now,
        createTime: now
      })

      return apiUtil.data(created)
    } finally {
      await queryRunner.release()
    }

  }

  private async assertVersionExists(name: string, id: number) {
    const table = createVersionTable(name)
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
        .getRawOne()

      if (!version) {
        return apiUtil.error('Version does not exist')
      }
    } finally {
      await queryRunner.release()
    }
  }

  private async insertIntoDynamicTable(table: Table, payload: Record<string, any>) {
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      return await this.insertIntoDynamicTableByQueryRunner(queryRunner, table, payload)
    } finally {
      await queryRunner.release()
    }
  }

  private async insertIntoDynamicTableByQueryRunner(
    queryRunner: QueryRunner,
    table: Table,
    payload: Record<string, any>
  ) {
    await this.ensureTable(queryRunner, table)

    const insertPayload = this.prepareDynamicPayload(table, payload)
    const insertRes = await queryRunner.manager
      .createQueryBuilder()
      .insert()
      .into(table.name)
      .values(insertPayload)
      .execute()

    const insertId = insertRes.identifiers[0]?.id ?? insertRes.raw?.insertId
    if (!insertId) {
      return apiUtil.error('Insert data failed')
    }

    const created = await queryRunner.manager
      .createQueryBuilder()
      .select('*')
      .from(table.name, table.name)
      .where('id = :id', { id: insertId })
      .getRawOne()

    return this.normalizeDynamicResult(table, created ?? { id: insertId, ...insertPayload })
  }

  private async updateDynamicTable(table: Table, id: number, payload: Record<string, any>) {
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return apiUtil.error('Error record does not exist')
      }

      const updatePayload = this.prepareDynamicPayload(table, { ...payload, id: undefined })
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
        .getRawOne()

      return this.normalizeDynamicResult(table, updated ?? { id, ...updatePayload })
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

    if (table.name.endsWith('_version') && missingColumns.some(column => column.name === 'update_type')) {
      await this.backfillVersionUpdateType(queryRunner, table.name)
    }

    if (
      table.name.endsWith('_error_log')
      && missingColumns.some(column => ['error_hash', 'report_count', 'update_time'].includes(column.name))
    ) {
      await this.backfillAppErrorLogColumns(queryRunner, table.name)
    }
  }

  private async backfillVersionUpdateType(queryRunner: QueryRunner, tableName: string) {
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

  private async backfillAppErrorLogColumns(queryRunner: QueryRunner, tableName: string) {
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

  private async ensureVersionTableAutoIncrement(queryRunner: QueryRunner, tableName: string) {
    await queryRunner.query(
      `ALTER TABLE \`${tableName}\` AUTO_INCREMENT = ${VERSION_TABLE_AUTO_INCREMENT_START}`
    )
  }

  private compactObject(payload: Record<string, any>) {
    return Object.fromEntries(
      Object.entries(payload).filter(([, value]) => value !== undefined)
    )
  }

  private prepareDynamicPayload(table: Table, payload: Record<string, any>) {
    const compactedPayload = this.compactObject(humpToUnderline(payload))
    const jsonColumnNames = new Set(
      table.columns
        .filter(column => column.type === 'json')
        .map(column => column.name)
    )

    return Object.fromEntries(
      Object.entries(compactedPayload).map(([key, value]) => {
        if (!jsonColumnNames.has(key)) {
          return [key, value]
        }

        return [key, this.stringifyJsonColumnValue(value)]
      })
    )
  }

  private normalizeDynamicResult(table: Table, record: Record<string, any>) {
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

    return underlineToHump(normalizedRecord)
  }

  private stringifyJsonColumnValue(value: any) {
    if (value === undefined) return value
    if (value === null) return null

    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value))
      } catch {
        return JSON.stringify(value)
      }
    }

    return JSON.stringify(value)
  }

  private parseJsonColumnValue(value: any) {
    if (typeof value !== 'string') {
      return value
    }

    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  private normalizeExtras(extras?: string) {
    if (!extras) return undefined

    return extras
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
      .update(segments.map(segment => this.normalizeErrorHashSegment(segment)).join('|'))
      .digest('hex')
  }

  private normalizeErrorHashSegment(value: string) {
    return value.replace(/\r\n/g, '\n').trim()
  }
}
