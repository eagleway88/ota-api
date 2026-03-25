
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner, Table } from 'typeorm'
import { Request } from 'express'
import { apiUtil } from '@/utils/api'
import { ConfigService } from '@nestjs/config'
import { UpdaterUtil } from '@/utils/updater'
import {
  createErrorTable,
  createSuccessTable,
  createVersionTable
} from '@/utils/version'
import { fetchIP, humpToUnderline, underlineToHump } from '@/utils'
import {
  CheckDto,
  CreateDto,
  ErrorDto,
  SuccessDto,
  UpdateType,
  UploadDto
} from './version.dto'
import { WsService } from '@/ws/ws.service'

@Injectable()
export class VersionService {
  private updater?: UpdaterUtil
  constructor(
    private readonly wsService: WsService,
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

    if (created) this.wsService.sendBroadcast(body.name, created)

    return apiUtil.data(created)
  }

  async check(body: CheckDto) {
    const table = createVersionTable(body.name)
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return apiUtil.data(null)
      }

      await this.syncTableColumns(queryRunner, table)

      // 先构造所有更新查询共用的基础条件：启用状态、平台命中、渠道命中。
      // 后续在这个基础上再分别叠加“全量更新”与“热更新”的规则。
      const baseQuery = queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, 'version')
        .where('version.enable = :enable', { enable: 1 })
        .andWhere("FIND_IN_SET(:platform, REPLACE(version.platform, ' ', '')) > 0", {
          platform: body.platform
        })

      if (body.channel) {
        // 指定渠道时，优先匹配该渠道，同时兼容 channel 为空的公共版本。
        baseQuery.andWhere(
          '(version.channel = :channel OR version.channel IS NULL OR version.channel = \"\")',
          { channel: body.channel }
        )
      }

      // 规则 1：如果存在比当前版本更高的全量更新，直接返回版本号最大的那条。
      // 这样客户端会优先走完整升级链路，而不是继续停留在当前版本打热更新补丁。
      const fullUpdate = await baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Full
        })
        .andWhere('version.ver > :ver', { ver: body.ver })
        .orderBy('version.ver', 'DESC')
        .addOrderBy('version.id', 'DESC')
        .getRawOne()

      if (fullUpdate) {
        return apiUtil.data(underlineToHump(fullUpdate))
      }

      // 规则 2：如果没有更高版本的全量更新，则只返回当前版本内可继续应用的热更新。
      // 这里要求 version.id 大于客户端已应用的 id，避免重复下发旧热更新。
      const hotUpdate = await baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Hot
        })
        .andWhere('version.ver = :ver', { ver: body.ver })
        .andWhere('version.id > :id', { id: body.id || 0 })
        .orderBy('version.id', 'DESC')
        .getRawOne()

      return apiUtil.data(hotUpdate ? underlineToHump(hotUpdate) : null)
    } finally {
      await queryRunner.release()
    }
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
    if (created) this.wsService.sendBroadcast(body.name, created)
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
    } finally {
      await queryRunner.release()
    }
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
}
