import { DataSource, QueryRunner } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { PublishTaskWorkerService } from '@/infrastructure/tasks/publish-task-worker.service'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { OtaVersionQueryService } from '@/compat/legacy/http/version/ota-version-query.service'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { WsService } from '@/ws/ws.service'
import { mapStoredReleaseRecord } from './release-record.mapper'
import { ReleaseManagementService } from './release-management.service'
import { DualWriteReleaseRepository } from '@/compat/legacy/persistence/dual-write-release.repository'

function fixture() {
  const row: Record<string, unknown> = {
    id: 2000,
    release_id: 'release-a',
    name: 'app',
    ver: 110,
    platform: 'windows',
    update_type: 'full',
    install_url: 'https://example.test/app.exe',
    release_scope: 'public',
    enable: 1,
    is_enabled: 1,
    policy_revision: 1
  }
  const writes: Array<{ table: string; values: Record<string, unknown> }> = []
  const tables = new ApplicationTableResolver().resolve('app', 'app')
  const application = { appName: 'app', tablePrefix: 'app', tables }
  const runner = {
    connect: jest.fn(),
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
          : [{ table_prefix: 'app', status: 'ready', schema_version: 1 }]
      )
    ),
    release: jest.fn(),
    manager: {
      createQueryBuilder: () => {
        let table = ''
        let values: Record<string, unknown> = {}
        const builder = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          setLock: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          update: (name: string) => {
            table = name
            return builder
          },
          into: (name: string) => {
            table = name
            return builder
          },
          set: (input: Record<string, unknown>) => {
            values = input
            return builder
          },
          values: (input: Record<string, unknown>) => {
            values = input
            return builder
          },
          getRawOne: () => Promise.resolve({ ...row }),
          execute: () => {
            writes.push({ table, values })
            if (table === tables.version) Object.assign(row, values)
            return Promise.resolve({ affected: 1 })
          }
        }
        return builder
      }
    }
  }
  const catalog = {
    invalidate: jest.fn(),
    loadCatalog: () =>
      Promise.resolve({
        available: { revision: 1, releases: [mapStoredReleaseRecord(row)] },
        audience: {
          revision: 1,
          userIdsByReleaseId: new Map<string, Set<string>>()
        }
      })
  }
  const query = new OtaVersionQueryService(
    catalog as unknown as ReleaseCatalogService
  )
  const subscriptions = new ConnectionSubscriptionStore()
  const ws = new WsService(query, {} as never, subscriptions)
  const client = {
    id: 'socket-a',
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn()
  }
  ws.server = { sockets: { sockets: new Map([[client.id, client]]) } } as never
  const worker = { execute: jest.fn(() => ws.dispatchApplicationUpdate('app')) }
  const applications = {
    prepare: jest.fn().mockResolvedValue(application),
    incrementCatalogRevision: jest.fn().mockResolvedValue(2)
  }
  const service = new ReleaseManagementService(
    { createQueryRunner: () => runner as unknown as QueryRunner } as DataSource,
    applications as unknown as ApplicationRegistryService,
    catalog as unknown as ReleaseCatalogService,
    worker as unknown as PublishTaskWorkerService,
    new DualWriteReleaseRepository()
  )
  const context = { requestId: 'request-a', actorAdminId: 1 }
  const updateQuery = { name: 'app', platform: 'windows', ver: 100, id: 0 }
  return {
    row,
    writes,
    tables,
    runner,
    catalog,
    query,
    ws,
    client,
    worker,
    applications,
    service,
    context,
    updateQuery
  }
}

describe('ReleaseManagementService enabled policy', () => {
  it('dual-writes enabled state and uses it for checks, replay, revocation and re-enable', async () => {
    const f = fixture()
    await f.ws.handleOtaNameSubscribe(f.client as never, {
      otaName: 'app',
      platform: 'windows',
      ver: 100,
      id: 0
    })
    expect(f.client.emit).toHaveBeenLastCalledWith(
      'app',
      expect.objectContaining({ id: 2000, enable: 1 })
    )
    f.client.emit.mockClear()

    await f.service.setEnabled('app', 'release-a', false, f.context)
    expect(f.writes).toContainEqual({
      table: f.tables.version,
      values: { enable: 0, is_enabled: 0 }
    })
    expect(mapStoredReleaseRecord(f.row).enabled).toBe(false)
    await expect(
      f.query.findLatestAvailableVersion(f.updateQuery)
    ).resolves.toBeNull()
    expect(f.client.emit).toHaveBeenCalledTimes(1)
    expect(f.client.emit).toHaveBeenLastCalledWith(
      'app',
      expect.objectContaining({ id: 2000, enable: 0 })
    )

    const newcomer = { ...f.client, id: 'socket-b', emit: jest.fn() }
    await f.ws.handleOtaNameSubscribe(newcomer as never, {
      otaName: 'app',
      platform: 'windows',
      ver: 100,
      id: 0
    })
    expect(newcomer.emit).not.toHaveBeenCalled()

    await f.service.setEnabled('app', 'release-a', true, f.context)
    expect(f.writes).toContainEqual({
      table: f.tables.version,
      values: { enable: 1, is_enabled: 1 }
    })
    await expect(
      f.query.findLatestAvailableVersion(f.updateQuery)
    ).resolves.toEqual(expect.objectContaining({ id: 2000, enable: 1 }))
    expect(f.client.emit).toHaveBeenLastCalledWith(
      'app',
      expect.objectContaining({ id: 2000, enable: 1 })
    )
    expect(f.runner.commitTransaction).toHaveBeenCalledTimes(2)
    expect(f.catalog.invalidate).toHaveBeenCalledTimes(2)
    expect(f.runner.commitTransaction.mock.invocationCallOrder[0]).toBeLessThan(
      f.catalog.invalidate.mock.invocationCallOrder[0]
    )
    expect(
      f.writes
        .filter(write => write.table === f.tables.publishTask)
        .map(write => write.values.action)
    ).toEqual(['disable', 'enable'])
    expect(
      f.writes
        .filter(write => write.table === f.tables.auditLog)
        .map(write => write.values.action)
    ).toEqual(['disable', 'enable'])
  })

  it('does not invalidate or dispatch when the policy transaction fails', async () => {
    const f = fixture()
    f.applications.incrementCatalogRevision.mockRejectedValueOnce(
      new Error('database failed')
    )
    await expect(
      f.service.setEnabled('app', 'release-a', false, f.context)
    ).rejects.toThrow('database failed')
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1)
    expect(f.runner.commitTransaction).not.toHaveBeenCalled()
    expect(f.runner.release).toHaveBeenCalledTimes(1)
    expect(f.catalog.invalidate).not.toHaveBeenCalled()
    expect(f.worker.execute).not.toHaveBeenCalled()
  })
})
