import { Injectable, Optional } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { createVersionTable, createTableName } from '@/utils/version'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import {
  AudienceSnapshot,
  AvailableReleaseSnapshot
} from '@/contracts/releases'
import { mapStoredReleaseRecord } from '@/releases/release-record.mapper'

export type ReleaseCatalog = {
  available: AvailableReleaseSnapshot
  audience: AudienceSnapshot
}

@Injectable()
export class ReleaseCatalogService {
  private readonly cache = new Map<
    string,
    { expiresAt: number; catalog: ReleaseCatalog }
  >()
  private readonly loads = new Map<string, Promise<ReleaseCatalog>>()

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Optional() private readonly applications?: ApplicationRegistryService
  ) {}

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

  private async loadCatalogFromDatabase(
    appName: string
  ): Promise<ReleaseCatalog> {
    const application = this.applications
      ? await this.applications.resolve(appName)
      : undefined
    const table = createVersionTable(application?.tablePrefix ?? appName)
    const audienceTableName =
      application?.tables.releaseUser ??
      `${createTableName(appName)}_release_user`
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

      const releases = records.map(mapStoredReleaseRecord)
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
