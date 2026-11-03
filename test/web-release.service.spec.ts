import { DataSource, QueryRunner } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import {
  PlatformType,
  ReleaseScopeType,
  UpdateType
} from '@/contracts/release-values'
import { CreateReleaseDraftDto } from '@/releases/release-draft.dto'
import { ReleaseDraftService } from '@/releases/release-draft.service'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'

function fixture() {
  const tables = new ApplicationTableResolver().resolve('website', 'website')
  const application = { appName: 'website', tablePrefix: 'website', tables }
  const stored: Record<string, unknown> = {}
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    isTransactionActive: false,
    startTransaction: jest.fn(() => {
      runner.isTransactionActive = true
    }),
    commitTransaction: jest.fn(() => {
      runner.isTransactionActive = false
    }),
    rollbackTransaction: jest.fn(() => {
      runner.isTransactionActive = false
    }),
    query: jest.fn((sql: string) =>
      Promise.resolve(
        sql.includes('GET_LOCK')
          ? [{ acquired: 1 }]
          : [{ table_prefix: 'website', status: 'ready', schema_version: 1 }]
      )
    ),
    manager: {
      createQueryBuilder: () => {
        let table = ''
        let values: Record<string, unknown> = {}
        const builder = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          setLock: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          into: (name: string) => {
            table = name
            return builder
          },
          update: (name: string) => {
            table = name
            return builder
          },
          values: (input: Record<string, unknown>) => {
            values = input
            return builder
          },
          set: (input: Record<string, unknown>) => {
            values = input
            return builder
          },
          getRawOne: () => Promise.resolve({ ...stored }),
          execute: () => {
            if (table === tables.releaseDraft) Object.assign(stored, values)
            return Promise.resolve({ affected: 1 })
          }
        }
        return builder
      }
    }
  }
  const releases = {
    insert: jest.fn().mockResolvedValue({ releaseSequence: 1 }),
    setEnabled: jest.fn()
  }
  const catalog = { invalidate: jest.fn() }
  const service = new ReleaseDraftService(
    { createQueryRunner: () => runner as unknown as QueryRunner } as DataSource,
    {
      requireReady: jest.fn().mockResolvedValue(application),
      incrementCatalogRevision: jest.fn().mockResolvedValue(1)
    } as unknown as ApplicationRegistryService,
    catalog as unknown as ReleaseCatalogService,
    releases
  )
  const body: CreateReleaseDraftDto = {
    targetVersion: '1.3.11',
    platforms: [PlatformType.Web],
    updateType: UpdateType.Full,
    releaseScope: ReleaseScopeType.Public,
    userIds: [],
    mandatory: false,
    showUpdateDialog: true
  }
  return { service, body, stored, releases, catalog }
}

describe('Web refresh publication', () => {
  const context = { requestId: 'web-test' }
  it('creates and publishes a Web-only full release without an artifact or URL', async () => {
    const { service, body, releases, catalog } = fixture()
    const draft = await service.createDraft('website', body, undefined, context)
    const published = await service.publish(
      'website',
      draft.data.releaseId,
      context
    )
    expect(published.data).toMatchObject({
      releaseId: draft.data.releaseId,
      releaseSequence: 1,
      status: 'published'
    })
    expect(releases.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        ...body,
        installerSourceUrl: undefined,
        bundleUrl: undefined
      })
    )
    expect(catalog.invalidate).toHaveBeenCalledWith('website')
  })

  it.each([
    ...[
      PlatformType.iOS,
      PlatformType.Android,
      PlatformType.Windows,
      PlatformType.Linux,
      PlatformType.Macos
    ].map(platform => ({ platforms: [platform], updateType: UpdateType.Full })),
    { platforms: [PlatformType.Web], updateType: UpdateType.Hot },
    {
      platforms: [PlatformType.Web, PlatformType.Windows],
      updateType: UpdateType.Full
    },
    {
      platforms: [PlatformType.Windows, PlatformType.Web],
      updateType: UpdateType.Full
    }
  ])(
    'still requires resources for %j at creation and publication',
    async input => {
      const { service, body, stored, releases } = fixture()
      const payload = { ...body, ...input }
      await expect(
        service.createDraft('website', payload, undefined, context)
      ).rejects.toThrow('A release artifact or URL is required')
      Object.assign(stored, { status: 'draft', payload })
      await expect(
        service.publish('website', 'stored-draft', context)
      ).rejects.toThrow(
        input.updateType === UpdateType.Full
          ? 'Full updates require an installer URL'
          : 'Hot updates require a bundle URL'
      )
      expect(releases.insert).not.toHaveBeenCalled()
    }
  )

  it('preserves an explicitly provided Web installer URL', async () => {
    const { service, body, releases } = fixture()
    const installerSourceUrl = 'https://example.test/website'
    const draft = await service.createDraft(
      'website',
      { ...body, installerSourceUrl },
      undefined,
      context
    )
    await service.publish('website', draft.data.releaseId, context)
    expect(releases.insert).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ installerSourceUrl })
    )
  })
})
