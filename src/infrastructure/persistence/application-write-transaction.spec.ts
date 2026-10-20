import { DataSource } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from './application-table-resolver'
import { withApplicationWrite } from './application-write-transaction'

const application: RegisteredApplication = {
  appName: 'app',
  tablePrefix: 'app_123a',
  schemaVersion: 1,
  status: 'ready',
  tables: new ApplicationTableResolver().resolve('app', 'app_123a')
}
function fixture() {
  const order: string[] = []
  const runner = {
    isTransactionActive: false,
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn((sql: string) => {
      order.push(sql)
      return Promise.resolve(
        sql.includes('GET_LOCK')
          ? [{ acquired: 1 }]
          : [
              {
                table_prefix: application.tablePrefix,
                status: 'ready',
                schema_version: 1
              }
            ]
      )
    }),
    startTransaction: jest.fn(() => {
      runner.isTransactionActive = true
      order.push('begin')
    }),
    commitTransaction: jest.fn(() => {
      runner.isTransactionActive = false
      order.push('commit')
    }),
    rollbackTransaction: jest.fn(() => {
      runner.isTransactionActive = false
      order.push('rollback')
    })
  }
  const source = { createQueryRunner: () => runner } as unknown as DataSource
  return { runner, order, source }
}
describe('application write transaction', () => {
  it('takes the shared lock before row/ID allocation and holds it through commit', async () => {
    const f = fixture()
    const result = await withApplicationWrite(f.source, application, () => {
      f.order.push('insert')
      return Promise.resolve(2000)
    })
    expect(result).toBe(2000)
    expect(f.order).toEqual([
      'SELECT GET_LOCK(?, 30) AS acquired',
      'begin',
      'SELECT table_prefix, status, schema_version FROM ota_applications WHERE app_name = ? FOR UPDATE',
      'insert',
      'commit',
      'SELECT RELEASE_LOCK(?)'
    ])
    expect(f.runner.release).toHaveBeenCalledTimes(1)
  })
  it('rolls back before unlocking and returns the connection after a failed write', async () => {
    const f = fixture()
    await expect(
      withApplicationWrite(f.source, application, () =>
        Promise.reject(new Error('injected'))
      )
    ).rejects.toThrow('injected')
    expect(f.order.slice(-2)).toEqual(['rollback', 'SELECT RELEASE_LOCK(?)'])
    expect(f.runner.release).toHaveBeenCalledTimes(1)
  })
  it('rejects a busy lock without beginning a transaction or releasing another owner lock', async () => {
    const f = fixture()
    f.runner.query.mockResolvedValueOnce([{ acquired: 0 }])
    const write = jest.fn()
    await expect(
      withApplicationWrite(f.source, application, write)
    ).rejects.toThrow('busy')
    expect(write).not.toHaveBeenCalled()
    expect(f.runner.startTransaction).not.toHaveBeenCalled()
    expect(f.runner.query).toHaveBeenCalledTimes(1)
    expect(f.runner.release).toHaveBeenCalledTimes(1)
  })
  it.each([
    { table_prefix: 'app_123a', status: 'preparing', schema_version: 1 },
    { table_prefix: 'app_123a', status: 'failed', schema_version: 1 },
    { table_prefix: 'app_123a', status: 'ready', schema_version: 0 },
    { table_prefix: 'other', status: 'ready', schema_version: 1 }
  ])('revalidates stale prepare results under the lock: %j', async row => {
    const f = fixture()
    f.runner.query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([row])
    const write = jest.fn()
    await expect(
      withApplicationWrite(f.source, application, write)
    ).rejects.toThrow('not ready')
    expect(write).not.toHaveBeenCalled()
    expect(f.runner.rollbackTransaction).toHaveBeenCalledTimes(1)
    expect(f.runner.release).toHaveBeenCalledTimes(1)
  })
})
