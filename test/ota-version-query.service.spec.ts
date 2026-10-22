import { DataSource, QueryRunner } from 'typeorm'
import { OtaVersionQueryService } from '@/compat/legacy/http/version/ota-version-query.service'
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

describe('OtaVersionQueryService', () => {
  it('loads release and audience snapshots once and applies exact allowlists', async () => {
    const releases = queryBuilder([
      {
        id: 2000,
        release_id: 'release-private',
        release_scope: 'allowlist',
        name: 'app',
        ver: 110,
        base_versions: '100',
        platform: 'windows',
        architecture: 'x64',
        update_type: 'hot',
        enable: 1,
        mandatory: 0,
        show_dialog: 1,
        package_url: 'https://example.test/update.zip'
      }
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
      hasTable: jest.fn((name: string) =>
        Promise.resolve(name !== 'ota_applications')
      ),
      manager: {
        createQueryBuilder: jest
          .fn()
          .mockReturnValueOnce(releases)
          .mockReturnValueOnce(audience)
      }
    } as unknown as QueryRunner
    const createQueryRunner = jest.fn().mockReturnValue(queryRunner)
    const dataSource = {
      createQueryRunner
    } as unknown as DataSource
    const service = new OtaVersionQueryService(
      new ReleaseCatalogService(
        dataSource,
        new ApplicationRegistryService(
          dataSource,
          new ApplicationTableResolver()
        )
      )
    )
    const baseQuery = {
      name: 'app',
      platform: 'windows',
      architecture: 'x64',
      ver: 100,
      id: 0
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
        id: 2000,
        name: 'app',
        packageUrl: 'https://example.test/update.zip'
      })
    )

    expect(createQueryRunner).toHaveBeenCalledTimes(1)
    expect(releaseQueryRunner).toHaveBeenCalledTimes(1)
  })
})
