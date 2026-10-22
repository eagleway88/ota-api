import { DataSource } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

function setup({ acquired = 1, pending = false } = {}) {
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
      read_model: 'formal'
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
      Promise.resolve(
        sql.includes('GET_LOCK')
          ? [{ acquired }]
          : sql.startsWith('SELECT migration_key')
            ? pending
              ? [{ migration_key: 'formal-fields-v1' }]
              : []
            : []
      )
    )
  }
  const source = { createQueryRunner: () => runner } as unknown as DataSource
  return {
    runner,
    service: new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
  }
}

describe('application preparation migration isolation', () => {
  it('does not downgrade or re-run DDL for a ready, migrated application', async () => {
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
  it.each([{ acquired: 0 }, { pending: true }])(
    'does not mark a competing/paused migration failed: %j',
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
