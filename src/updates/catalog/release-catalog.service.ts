import { ConflictException, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
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
    private readonly applications: ApplicationRegistryService
  ) {}

  invalidate(appName: string) {
    this.cache.delete(appName)
    // Existing callers will adopt the next load; stale work cannot refill cache.
    this.loads.delete(appName)
  }

  async loadCatalog(appName: string, force = false): Promise<ReleaseCatalog> {
    if (force) this.invalidate(appName)
    const cached = this.cache.get(appName)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.catalog
    }

    const activeLoad = this.loads.get(appName)
    if (activeLoad) {
      return activeLoad
    }

    const load: Promise<ReleaseCatalog> = this.loadCatalogFromDatabase(appName)
      .then(
        catalog => {
          if (this.loads.get(appName) !== load) return this.loadCatalog(appName)
          this.cache.set(appName, { catalog, expiresAt: Date.now() + 5_000 })
          return catalog
        },
        (error: unknown) => {
          if (this.loads.get(appName) !== load) return this.loadCatalog(appName)
          throw error
        }
      )
      .finally(() => {
        if (this.loads.get(appName) === load) this.loads.delete(appName)
      })
    this.loads.set(appName, load)
    return load
  }

  private async loadCatalogFromDatabase(
    appName: string
  ): Promise<ReleaseCatalog> {
    const queryRunner = this.dataSource.createQueryRunner()

    await queryRunner.connect()

    try {
      await queryRunner.startTransaction('REPEATABLE READ')
      const application = await this.applications.resolveSnapshot(
        appName,
        queryRunner
      )
      if (application.status !== 'ready' || application.schemaVersion < 1)
        throw new ConflictException(
          'Application is not ready; prepare it using the CLI'
        )
      const { version, releaseUser } = application.tables
      const revision = application.catalogRevision
      if (
        !(await queryRunner.hasTable(version)) ||
        !(await queryRunner.hasTable(releaseUser))
      )
        throw new ConflictException('Application release schema is incomplete')

      const records = await queryRunner.manager
        .createQueryBuilder()
        .select('*')
        .from(version, 'version')
        .where('version.app_name = :name', { name: appName })
        .getRawMany<Record<string, unknown>>()

      const releases = records.map(mapStoredReleaseRecord)
      const userIdsByReleaseId = new Map<string, Set<string>>()
      if (await queryRunner.hasTable(releaseUser)) {
        const audienceRecords = await queryRunner.manager
          .createQueryBuilder()
          .select(['audience.release_id', 'audience.user_id'])
          .from(releaseUser, 'audience')
          .getRawMany<{ release_id: string; user_id: string }>()
        for (const record of audienceRecords) {
          const userIds =
            userIdsByReleaseId.get(record.release_id) ?? new Set<string>()
          userIds.add(record.user_id)
          userIdsByReleaseId.set(record.release_id, userIds)
        }
      }

      await queryRunner.commitTransaction()
      return {
        available: { revision, releases },
        audience: { revision, userIdsByReleaseId }
      }
    } catch (error) {
      if (queryRunner.isTransactionActive)
        await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
  }
}
