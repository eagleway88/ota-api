import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { underlineToHump } from '@/utils'
import { createVersionTable } from '@/utils/version'
import { UpdateType } from './version.dto'

type OtaVersionQuery = {
  name: string
  platform: string
  channel?: string
  ver: number
  id?: number
}

@Injectable()
export class OtaVersionQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) { }

  async findLatestAvailableVersion(query: OtaVersionQuery) {
    if (!query.name || !query.platform || query.ver == null) {
      return null
    }

    const table = createVersionTable(query.name)
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return null
      }

      const baseQuery = queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, 'version')
        .where('version.enable = :enable', { enable: 1 })
        .andWhere("FIND_IN_SET(:platform, REPLACE(version.platform, ' ', '')) > 0", {
          platform: query.platform
        })

      if (query.channel) {
        baseQuery.andWhere(
          '(version.channel = :channel OR version.channel IS NULL OR version.channel = "")',
          { channel: query.channel }
        )
      }

      const fullUpdate = await baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Full
        })
        .andWhere('version.ver > :ver', { ver: query.ver })
        .orderBy('version.ver', 'DESC')
        .addOrderBy('version.id', 'DESC')
        .getRawOne()

      if (fullUpdate) {
        return underlineToHump({
          ...fullUpdate,
          // 兼容旧版字段
          type: 1,
          downloadUrl: fullUpdate.install_url,
          isMandatory: fullUpdate.mandatory
        })
      }

      const hotUpdate = await baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Hot
        })
        .andWhere('version.ver = :ver', { ver: query.ver })
        .andWhere('version.id > :id', { id: query.id || 0 })
        .orderBy('version.id', 'DESC')
        .getRawOne()

      return hotUpdate
        ? underlineToHump({
          ...hotUpdate,
          // 兼容旧版字段
          type: 0,
          downloadUrl: hotUpdate.package_url,
          isMandatory: hotUpdate.mandatory
        })
        : null
    } finally {
      await queryRunner.release()
    }
  }
}