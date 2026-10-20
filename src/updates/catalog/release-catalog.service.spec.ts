import { DataSource } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { ReleaseCatalogService } from './release-catalog.service'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const release = {
  id: 2000,
  name: 'app',
  release_id: 'release-a',
  release_scope: 'allowlist',
  platform: 'windows',
  ver: 110,
  enable: 1,
  policy_revision: 999
}

function reader(
  revision: number,
  pending?: ReturnType<typeof deferred<Record<string, unknown>[]>>
) {
  const started = deferred<void>()
  const queries: string[] = []
  const runner = {
    isTransactionActive: false,
    connect: jest.fn(),
    startTransaction: jest.fn(() => {
      runner.isTransactionActive = true
    }),
    commitTransaction: jest.fn(() => {
      runner.isTransactionActive = false
    }),
    rollbackTransaction: jest.fn(() => {
      runner.isTransactionActive = false
    }),
    release: jest.fn(),
    hasTable: jest.fn().mockResolvedValue(true),
    manager: {
      createQueryBuilder: () => {
        let table = ''
        const builder = {
          select: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          from: (name: string) => {
            table = name
            return builder
          },
          getRawOne: () => {
            expect(runner.isTransactionActive).toBe(true)
            queries.push(table)
            return Promise.resolve({
              table_prefix: 'app_123a',
              schema_version: 1,
              status: 'ready',
              catalog_revision: revision
            })
          },
          getRawMany: () => {
            expect(runner.isTransactionActive).toBe(true)
            queries.push(table)
            if (table.endsWith('_version')) {
              started.resolve()
              return pending?.promise ?? Promise.resolve([{ ...release }])
            }
            return Promise.resolve([
              { release_id: 'release-a', user_id: 'app:windows:1' }
            ])
          }
        }
        return builder
      }
    }
  }
  return { runner, queries, started: started.promise }
}

function serviceFor(...readers: ReturnType<typeof reader>[]) {
  const createQueryRunner = jest.fn()
  for (const read of readers) createQueryRunner.mockReturnValueOnce(read.runner)
  const source = { createQueryRunner } as unknown as DataSource
  const applications = new ApplicationRegistryService(
    source,
    new ApplicationTableResolver()
  )
  return {
    service: new ReleaseCatalogService(source, applications),
    createQueryRunner
  }
}

describe('ReleaseCatalogService snapshots', () => {
  it('reads mapping, application revision, versions and audience in one repeatable-read transaction', async () => {
    const read = reader(42)
    const { service, createQueryRunner } = serviceFor(read)
    const catalog = await service.loadCatalog('app')
    expect(catalog.available.revision).toBe(42)
    expect(catalog.audience.revision).toBe(42)
    expect(catalog.available.releases[0].legacyPayload.policyRevision).toBe(999)
    expect(catalog.audience.userIdsByReleaseId.get('release-a')).toEqual(
      new Set(['app:windows:1'])
    )
    expect(read.queries).toEqual([
      'ota_applications',
      'app_123a_version',
      'app_123a_release_user'
    ])
    expect(read.runner.startTransaction).toHaveBeenCalledWith('REPEATABLE READ')
    expect(read.runner.commitTransaction).toHaveBeenCalledTimes(1)
    expect(read.runner.release).toHaveBeenCalledTimes(1)
    expect(createQueryRunner).toHaveBeenCalledTimes(1)
    expect(await service.loadCatalog('app')).toBe(catalog)
    expect(createQueryRunner).toHaveBeenCalledTimes(1)
  })

  it('coalesces ordinary concurrent reads', async () => {
    const gate = deferred<Record<string, unknown>[]>()
    const read = reader(10, gate)
    const { service, createQueryRunner } = serviceFor(read)
    const first = service.loadCatalog('app')
    await read.started
    const second = service.loadCatalog('app')
    gate.resolve([release])
    const [a, b] = await Promise.all([first, second])
    expect(a).toBe(b)
    expect(createQueryRunner).toHaveBeenCalledTimes(1)
  })

  it.each(['invalidate', 'force'] as const)(
    'does not return or cache an obsolete in-flight result after %s',
    async mode => {
      const gate = deferred<Record<string, unknown>[]>()
      const old = reader(10, gate)
      const fresh = reader(11)
      const { service, createQueryRunner } = serviceFor(old, fresh)
      const oldResult = service.loadCatalog('app')
      await old.started
      if (mode === 'invalidate') service.invalidate('app')
      const freshResult = await service.loadCatalog('app', mode === 'force')
      gate.resolve([release])
      expect(await oldResult).toBe(freshResult)
      expect(await service.loadCatalog('app')).toBe(freshResult)
      expect(freshResult.available.revision).toBe(11)
      expect(createQueryRunner).toHaveBeenCalledTimes(2)
    }
  )

  it('does not remove the replacement load when an invalidated query finishes', async () => {
    const oldGate = deferred<Record<string, unknown>[]>()
    const newGate = deferred<Record<string, unknown>[]>()
    const old = reader(10, oldGate)
    const fresh = reader(11, newGate)
    const { service, createQueryRunner } = serviceFor(old, fresh)
    const first = service.loadCatalog('app')
    await old.started
    service.invalidate('app')
    const second = service.loadCatalog('app')
    await fresh.started
    oldGate.resolve([release])
    await new Promise<void>(resolve => setImmediate(resolve))
    const third = service.loadCatalog('app')
    newGate.resolve([release])
    const catalogs = await Promise.all([first, second, third])
    expect(catalogs.every(catalog => catalog === catalogs[0])).toBe(true)
    expect(createQueryRunner).toHaveBeenCalledTimes(2)
  })

  it('rolls back failed reads, releases the connection and allows a retry', async () => {
    const gate = deferred<Record<string, unknown>[]>()
    const broken = reader(10, gate)
    const fresh = reader(11)
    const { service } = serviceFor(broken, fresh)
    const result = service.loadCatalog('app')
    const rejection = expect(result).rejects.toThrow('read failed')
    await broken.started
    gate.reject(new Error('read failed'))
    await rejection
    expect(broken.runner.rollbackTransaction).toHaveBeenCalledTimes(1)
    expect(broken.runner.release).toHaveBeenCalledTimes(1)
    expect(broken.runner.commitTransaction).not.toHaveBeenCalled()
    expect((await service.loadCatalog('app')).available.revision).toBe(11)
  })

  it('keeps the registered revision even for an empty version table', async () => {
    const read = reader(42)
    read.runner.hasTable.mockImplementation((name: string) =>
      Promise.resolve(!name.endsWith('_version'))
    )
    const { service } = serviceFor(read)
    const result = await service.loadCatalog('app')
    expect(result.available).toEqual({ revision: 42, releases: [] })
    expect(result.audience.revision).toBe(42)
    expect(read.runner.commitTransaction).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the registered revision is invalid', async () => {
    const read = reader(Number.NaN)
    const { service } = serviceFor(read)
    await expect(service.loadCatalog('app')).rejects.toThrow(
      'catalog revision is invalid'
    )
    expect(read.queries).toEqual(['ota_applications'])
    expect(read.runner.rollbackTransaction).toHaveBeenCalledTimes(1)
  })
})
