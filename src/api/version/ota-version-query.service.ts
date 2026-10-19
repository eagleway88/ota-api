import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { createVersionTable } from '@/utils/version'
import {
  defaultApplicationUpdatePolicy,
  ClientUpdateContext
} from '@/contracts/releases'
import { resolveUpdate } from '@/updates/decision/resolve-update'
import {
  mapLegacyReleaseRecord,
  serializeLegacyRelease
} from '@/compat/legacy/mappers/release.mapper'

export type OtaVersionQuery = {
  name: string
  platform: string
  architecture?: string
  channel?: string
  ver: number
  id?: number
  userIds?: readonly string[]
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

      const records = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, 'version')
        .where('version.name = :name', { name: query.name })
        .getRawMany<Record<string, unknown>>()

      const releases = records.map(mapLegacyReleaseRecord)
      const context: ClientUpdateContext = {
        appName: query.name,
        platform: query.platform,
        architecture: query.architecture,
        distributionChannel: query.channel,
        nativeVersionCode: query.ver,
        installedReleaseSequence: query.id ?? 0,
        userIds: new Set(query.userIds ?? [])
      }
      const decision = resolveUpdate(
        context,
        { revision: 0, releases },
        { revision: 0, userIdsByReleaseId: new Map() },
        defaultApplicationUpdatePolicy
      )

      return decision.release
        ? serializeLegacyRelease(
            decision.release,
            decision.mandatory,
            decision.showUpdateDialog
          )
        : null
    } finally {
      await queryRunner.release()
    }
  }
}
