
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

      // 数据库存的是类似 ios,android 这样的逗号分隔字符串，
      // 而 body.platform 只会是 ios / android 这种单值。
      // 这里用 FIND_IN_SET 做集合包含判断，并先去掉空格，兼容 ios, android 这类脏数据。
      const query = queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, 'version')
        .where('version.enable = :enable', { enable: 1 })
        .andWhere("FIND_IN_SET(:platform, REPLACE(version.platform, ' ', '')) > 0", {
          platform: body.platform
        })
        // 查询比当前客户端版本更高的记录。
        // 如果版本号相同，则继续比较自增 id，保证能取到更新发布的后续版本记录。
        .andWhere(
          '(version.ver > :ver OR (version.ver = :ver AND version.id > :id))',
          {
            ver: body.ver,
            id: body.id || 0
          }
        )

      if (body.channel) {
        // 传了 channel 时，优先命中该 channel 的版本；
        // 同时保留 channel 为空的公共版本。
        query.andWhere(
          '(version.channel = :channel OR version.channel IS NULL OR version.channel = \"\")',
          { channel: body.channel }
        )
      }

      // 排序规则：
      // 1. 先取更高版本号；
      // 2. 同版本号下，优先返回全量更新（update_type = full）；
      // 3. 最后再按 id 倒序兜底，保证相同类型时返回最新一条。
      const latest = await query
        .orderBy('version.ver', 'DESC')
        .addOrderBy(
          "CASE WHEN version.update_type = 'full' THEN 1 ELSE 0 END",
          'DESC'
        )
        .addOrderBy('version.id', 'DESC')
        .getRawOne()

      return apiUtil.data(latest ? underlineToHump(latest) : null)
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

      const insertPayload = this.compactObject(humpToUnderline(payload))
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

      return underlineToHump(created ?? { id: insertId, ...insertPayload })
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

      const updatePayload = this.compactObject(humpToUnderline({ ...payload, id: undefined }))
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

      return underlineToHump(updated ?? { id, ...updatePayload })
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

  private normalizeExtras(extras?: string) {
    if (!extras) return undefined

    try {
      return JSON.parse(extras)
    } catch {
      return extras
    }

  }
}
