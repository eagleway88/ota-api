import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { createVersionTable } from '@/utils/version'
import {
  AudienceSnapshot,
  AvailableReleaseSnapshot,
  defaultApplicationUpdatePolicy,
  ClientUpdateContext
} from '@/contracts/releases'
import { resolveUpdate } from '@/updates/decision/resolve-update'
import {
  mapLegacyReleaseRecord,
  serializeLegacyRelease
} from '@/compat/legacy/mappers/release.mapper'
import { createTableName } from '@/utils/version'

export type ReleaseCatalog = {
  available: AvailableReleaseSnapshot
  audience: AudienceSnapshot
}

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
  private readonly cache = new Map<
    string,
    { expiresAt: number; catalog: ReleaseCatalog }
  >()
  private readonly loads = new Map<string, Promise<ReleaseCatalog>>()

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async findLatestAvailableVersion(query: OtaVersionQuery) {
    if (!query.name || !query.platform || query.ver == null) {
      return null
    }

    const catalog = await this.loadCatalog(query.name)
    return this.resolveAvailableVersion(query, catalog)
  }

  invalidate(appName: string) {
    this.cache.delete(appName)
  }

  async loadCatalog(appName: string, force = false): Promise<ReleaseCatalog> {
    const cached = this.cache.get(appName)
    if (!force && cached && cached.expiresAt > Date.now()) {
      return cached.catalog
    }

    const activeLoad = this.loads.get(appName)
    if (activeLoad) {
      return activeLoad
    }

    const load = this.loadCatalogFromDatabase(appName).finally(() => {
      this.loads.delete(appName)
    })
    this.loads.set(appName, load)
    const catalog = await load
    this.cache.set(appName, {
      catalog,
      expiresAt: Date.now() + 5_000
    })
    return catalog
  }

  resolveAvailableVersion(
    query: OtaVersionQuery,
    catalog: ReleaseCatalog
  ): Record<string, unknown> | null {
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
      catalog.available,
      catalog.audience,
      defaultApplicationUpdatePolicy
    )

    return decision.release
      ? serializeLegacyRelease(
          decision.release,
          decision.mandatory,
          decision.showUpdateDialog
        )
      : null
  }

  private async loadCatalogFromDatabase(
    appName: string
  ): Promise<ReleaseCatalog> {
    const table = createVersionTable(appName)
    const audienceTableName = `${createTableName(appName)}_release_user`
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      const hasTable = await queryRunner.hasTable(table.name)
      if (!hasTable) {
        return this.emptyCatalog()
      }

      const records = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(table.name, 'version')
        .where('version.name = :name', { name: appName })
        .getRawMany<Record<string, unknown>>()

      const releases = records.map(mapLegacyReleaseRecord)
      const revision = releases.reduce((maximum, release) => {
        const value = Number(release.legacyPayload.policyRevision ?? 0)
        return Math.max(maximum, Number.isFinite(value) ? value : 0)
      }, 0)
      const userIdsByReleaseId = new Map<string, Set<string>>()
      if (await queryRunner.hasTable(audienceTableName)) {
        const audienceRecords = await queryRunner.manager
          .createQueryBuilder()
          .select(['audience.release_id', 'audience.user_id'])
          .from(audienceTableName, 'audience')
          .getRawMany<{ release_id: string; user_id: string }>()
        for (const record of audienceRecords) {
          const userIds =
            userIdsByReleaseId.get(record.release_id) ?? new Set<string>()
          userIds.add(record.user_id)
          userIdsByReleaseId.set(record.release_id, userIds)
        }
      }

      return {
        available: { revision, releases },
        audience: { revision, userIdsByReleaseId }
      }
    } finally {
      await queryRunner.release()
    }
  }

  private emptyCatalog(): ReleaseCatalog {
    return {
      available: { revision: 0, releases: [] },
      audience: { revision: 0, userIdsByReleaseId: new Map() }
    }
  }
}
