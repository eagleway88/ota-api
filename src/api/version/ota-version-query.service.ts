import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { underlineToHump } from '@/utils'
import { createVersionTable } from '@/utils/version'
import { UpdateType } from './version.dto'

type OtaVersionQuery = {
  name: string
  platform: string
  architecture?: string
  channel?: string
  ver: number
  id?: number
}

@Injectable()
export class OtaVersionQueryService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
        .andWhere(
          "FIND_IN_SET(:platform, REPLACE(version.platform, ' ', '')) > 0",
          {
            platform: query.platform
          }
        )

      if (query.architecture) {
        baseQuery.andWhere(
          "(version.architecture IS NULL OR version.architecture = '' OR FIND_IN_SET(:architecture, REPLACE(version.architecture, ' ', '')) > 0)",
          { architecture: query.architecture }
        )
      }

      if (query.channel) {
        baseQuery.andWhere(
          '(version.channel = :channel OR version.channel IS NULL OR version.channel = "")',
          { channel: query.channel }
        )
      }

      const fullUpdateQuery = baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Full
        })
        .andWhere('version.ver > :ver', { ver: query.ver })

      const fullUpdate = await fullUpdateQuery
        .clone()
        .orderBy('version.ver', 'DESC')
        .addOrderBy('version.id', 'DESC')
        .getRawOne()

      if (fullUpdate) {
        const hasPendingMandatoryFullUpdate = !!(await fullUpdateQuery
          .clone()
          .select('version.id', 'id')
          .andWhere('version.mandatory = :mandatory', { mandatory: 1 })
          .limit(1)
          .getRawOne())

        const isMandatory = hasPendingMandatoryFullUpdate
          ? 1
          : fullUpdate.mandatory

        return underlineToHump({
          ...fullUpdate,
          mandatory: isMandatory,
          show_dialog: isMandatory ? 1 : fullUpdate.show_dialog,
          // 兼容旧版字段
          type: 1,
          downloadUrl: fullUpdate.install_url,
          isMandatory
        })
      }

      const hotUpdateQuery = baseQuery
        .clone()
        .andWhere('version.update_type = :updateType', {
          updateType: UpdateType.Hot
        })
        .andWhere(
          `(version.ver = :ver
            OR (
              version.base_versions IS NOT NULL
              AND version.base_versions <> ''
              AND FIND_IN_SET(:verString, REPLACE(version.base_versions, ' ', '')) > 0
            ))`,
          {
            ver: query.ver,
            verString: String(query.ver)
          }
        )
        .andWhere('version.id > :id', { id: query.id || 0 })

      const hotUpdate = await hotUpdateQuery
        .clone()
        .orderBy('version.id', 'DESC')
        .getRawOne()

      if (!hotUpdate) {
        return null
      }

      const hasPendingMandatoryHotUpdate = !!(await hotUpdateQuery
        .clone()
        .select('version.id', 'id')
        .andWhere('version.mandatory = :mandatory', { mandatory: 1 })
        .limit(1)
        .getRawOne())

      const isMandatory = hasPendingMandatoryHotUpdate ? 1 : hotUpdate.mandatory

      return underlineToHump({
        ...hotUpdate,
        mandatory: isMandatory,
        show_dialog: isMandatory ? 1 : hotUpdate.show_dialog,
        // 兼容旧版字段
        type: 0,
        downloadUrl: hotUpdate.package_url,
        isMandatory
      })
    } finally {
      await queryRunner.release()
    }
  }
}
