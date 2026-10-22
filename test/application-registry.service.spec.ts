import { DataSource } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

function setup({ acquired = 1 } = {}) {
  const builder = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    getRawOne: jest.fn().mockResolvedValue({
      app_name: 'app',
      table_prefix: 'app_123a',
      status: 'ready',
      schema_version: 2,
      catalog_revision: 1
    })
  }
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    hasTable: jest.fn().mockResolvedValue(true),
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    rollbackTransaction: jest.fn(),
    manager: { createQueryBuilder: jest.fn(() => builder) },
    query: jest.fn((sql: string) =>
      Promise.resolve(sql.includes('GET_LOCK') ? [{ acquired }] : [])
    )
  }
  const source = { createQueryRunner: () => runner } as unknown as DataSource
  return {
    builder,
    runner,
    service: new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
  }
}

describe('application preparation runtime isolation', () => {
  it('runtime readiness checks never prepare tables, acquire preparation locks or start write transactions', async () => {
    const { service, runner } = setup()
    const prepare = jest.spyOn(service, 'prepare')
    expect(await service.requireReady('app')).toMatchObject({
      status: 'ready',
      schemaVersion: 2
    })
    expect(prepare).not.toHaveBeenCalled()
    expect(runner.query).not.toHaveBeenCalled()
    expect(runner.startTransaction).not.toHaveBeenCalled()
  })
  it.each(['preparing', 'failed'])(
    'runtime rejects %s applications without repairing their schema',
    async status => {
      const { service, builder, runner } = setup()
      builder.getRawOne.mockResolvedValue({
        app_name: 'app',
        table_prefix: 'app_123a',
        status,
        schema_version: 2,
        catalog_revision: 1
      })
      await expect(service.requireReady('app')).rejects.toThrow(
        'operational CLI'
      )
      expect(runner.query).not.toHaveBeenCalled()
    }
  )
  it('does not downgrade or re-run DDL for a ready application', async () => {
    const { service, runner } = setup()
    expect(await service.prepare('app')).toMatchObject({
      schemaVersion: 2,
      tablePrefix: 'app_123a',
      status: 'ready'
    })
    expect(
      runner.query.mock.calls
        .map(([sql]) => sql)
        .some(sql => /CREATE|UPDATE|ALTER/.test(sql))
    ).toBe(false)
    expect(runner.commitTransaction).toHaveBeenCalledTimes(1)
    expect(runner.release).toHaveBeenCalledTimes(1)
  })
  it.each([{ acquired: 0 }])(
    'does not mark a competing preparation failed: %j',
    async options => {
      const { service, runner } = setup(options)
      await expect(service.prepare('app')).rejects.toThrow()
      expect(runner.manager.createQueryBuilder).not.toHaveBeenCalled()
      expect(
        runner.query.mock.calls
          .map(([sql]) => sql)
          .some(sql => /UPDATE|INSERT|CREATE/.test(sql))
      ).toBe(false)
      expect(runner.release).toHaveBeenCalledTimes(1)
    }
  )
})
