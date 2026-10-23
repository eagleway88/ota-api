import { releaseRow } from './fixtures/release'
import { DataSource, QueryRunner } from 'typeorm'
import { UpdateQueryService } from '@/updates/update-query.service'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

function queryBuilder(rows: Record<string, unknown>[]) {
  const builder = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(rows)
  }
  builder.select.mockReturnValue(builder)
  builder.from.mockReturnValue(builder)
  builder.where.mockReturnValue(builder)
  return builder
}

describe('UpdateQueryService', () => {
  it('loads release and audience snapshots once and applies exact allowlists', async () => {
    const releases = queryBuilder([
      releaseRow({
        release_id: 'release-private',
        release_scope: 'allowlist',
        update_type: 'hot',
        bundle_url: 'https://example.test/update.zip'
      })
    ])
    const audience = queryBuilder([
      { release_id: 'release-private', user_id: 'app:windows:1' }
    ])
    const releaseQueryRunner = jest.fn()
    const queryRunner = {
      connect: jest.fn(),
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      release: releaseQueryRunner,
      hasTable: jest.fn().mockResolvedValue(true),
      manager: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce({
            select: jest.fn().mockReturnThis(),
            from: jest.fn().mockReturnThis(),
            where: jest.fn().mockReturnThis(),
            getRawOne: jest.fn().mockResolvedValue({
              app_name: 'app',
              table_prefix: 'app',
              schema_version: 1,
              status: 'ready',
              catalog_revision: 1
            })
          })
          .mockReturnValueOnce(releases)
          .mockReturnValueOnce(audience)
      }
    } as unknown as QueryRunner
    const createQueryRunner = jest.fn().mockReturnValue(queryRunner)
    const dataSource = {
      createQueryRunner
    } as unknown as DataSource
    const service = new UpdateQueryService(
      new ReleaseCatalogService(
        dataSource,
        new ApplicationRegistryService(
          dataSource,
          new ApplicationTableResolver()
        )
      )
    )
    const baseQuery = {
      appName: 'app',
      platform: 'windows',
      architecture: 'x64',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    }

    await expect(
      service.findLatestAvailableVersion(baseQuery)
    ).resolves.toBeNull()
    await expect(
      service.findLatestAvailableVersion({
        ...baseQuery,
        userIds: ['app:windows:1']
      })
    ).resolves.toEqual(
      expect.objectContaining({
        releaseSequence: 1,
        appName: 'app',
        bundleUrl: 'https://example.test/update.zip'
      })
    )

    expect(createQueryRunner).toHaveBeenCalledTimes(1)
    expect(releaseQueryRunner).toHaveBeenCalledTimes(1)
  })
})
