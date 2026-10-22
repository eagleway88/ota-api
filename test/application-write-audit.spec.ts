import {
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException
} from '@nestjs/common'
import { DataSource, QueryFailedError } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import {
  ApplicationWriteAudit,
  withAuditedApplicationWrite
} from '@/audit/application-write-audit'

const application: RegisteredApplication = {
  appName: 'app',
  tablePrefix: 'app_123a',
  status: 'ready',
  schemaVersion: 1,
  tables: new ApplicationTableResolver().resolve('app', 'app_123a')
}
const audit: ApplicationWriteAudit = {
  operationId: 'operation-a',
  context: { requestId: 'request-a', actorAdminId: 3, actorName: 'admin' },
  releaseId: 'release-a',
  action: 'disable',
  targetType: 'release',
  changeSummary: { enabled: false }
}

function fixture() {
  const rows: Record<string, unknown>[] = []
  const order: string[] = []
  function runner(name: string) {
    const connection = {
      isTransactionActive: false,
      connect: jest.fn(() => Promise.resolve()),
      release: jest.fn(() => {
        order.push(`${name}:release`)
        return Promise.resolve()
      }),
      startTransaction: jest.fn(() => {
        connection.isTransactionActive = true
        return Promise.resolve()
      }),
      commitTransaction: jest.fn(() => {
        connection.isTransactionActive = false
        return Promise.resolve()
      }),
      rollbackTransaction: jest.fn(() => {
        order.push(`${name}:rollback`)
        connection.isTransactionActive = false
        return Promise.resolve()
      }),
      query: jest.fn((sql: string) =>
        Promise.resolve(
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
      ),
      manager: {
        createQueryBuilder: () => {
          let values: Record<string, unknown>
          const builder = {
            insert: jest.fn().mockReturnThis(),
            into: jest.fn().mockReturnThis(),
            values: (input: Record<string, unknown>) => {
              values = input
              return builder
            },
            execute: jest.fn(() => {
              order.push(`${name}:insert`)
              rows.push(values)
              return Promise.resolve()
            })
          }
          return builder
        }
      }
    }
    return connection
  }
  const business = runner('business')
  const failure = runner('failure')
  const createQueryRunner = jest
    .fn()
    .mockReturnValueOnce(business)
    .mockReturnValueOnce(failure)
  const source = { createQueryRunner } as unknown as DataSource
  return { business, failure, createQueryRunner, rows, order, source }
}

describe('application failure audit', () => {
  let log: jest.SpyInstance
  beforeEach(() => {
    log = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined)
  })
  afterEach(() => jest.restoreAllMocks())

  it.each([
    [new BadRequestException('private request body'), 'INVALID_OPERATION'],
    [new NotFoundException('private identifier'), 'RELEASE_NOT_FOUND'],
    [new ConflictException('private conflict'), 'OPERATION_CONFLICT'],
    [
      new QueryFailedError(
        'SQL secret',
        ['token secret'],
        new Error('password secret')
      ),
      'DATABASE_WRITE_FAILED'
    ],
    [new Error('raw stack secret'), 'APPLICATION_OPERATION_FAILED']
  ])(
    'records a classified failure only after releasing the rolled back transaction',
    async (error, code) => {
      const f = fixture()
      const summary = {
        enabled: false,
        password: 'secret',
        userIds: ['private']
      }
      await expect(
        withAuditedApplicationWrite(
          f.source,
          application,
          { ...audit, changeSummary: summary },
          () => Promise.reject(error)
        )
      ).rejects.toBe(error)
      expect(f.order).toEqual([
        'business:rollback',
        'business:release',
        'failure:insert',
        'failure:release'
      ])
      expect(f.rows).toEqual([
        expect.objectContaining({
          operation_id: 'operation-a',
          request_id: 'request-a',
          actor_admin_id: 3,
          result: 'failed',
          error_code: code,
          task_id: null,
          revision_before: null,
          revision_after: null,
          change_summary: '{"enabled":false}'
        })
      ])
      expect(JSON.stringify(f.rows)).not.toMatch(/secret|private/)
      expect(log).not.toHaveBeenCalled()
    }
  )

  it('returns successful writes without creating a second transaction', async () => {
    const f = fixture()
    await expect(
      withAuditedApplicationWrite(f.source, application, audit, () =>
        Promise.resolve(2000)
      )
    ).resolves.toBe(2000)
    expect(f.createQueryRunner).toHaveBeenCalledTimes(1)
    expect(f.rows).toEqual([])
  })

  it('never masks the business error when the audit database is unavailable', async () => {
    const f = fixture()
    const error = new Error('original private body')
    f.failure.connect.mockRejectedValueOnce(
      new Error('database password secret')
    )
    await expect(
      withAuditedApplicationWrite(f.source, application, audit, () =>
        Promise.reject(error)
      )
    ).rejects.toBe(error)
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'application_failure_audit_unavailable',
        outcome: 'rolled_back',
        requestId: 'request-a',
        operationId: 'operation-a'
      })
    )
    expect(JSON.stringify(log.mock.calls)).not.toMatch(
      /private|password|secret/
    )
    expect(f.failure.release).toHaveBeenCalled()
    expect(f.rows).toEqual([])
  })

  it.each(['commit', 'rollback', 'cleanup'] as const)(
    'does not invent failed operations after uncertain %s or successful commit',
    async stage => {
      const f = fixture()
      const error = new Error('original secret')
      if (stage === 'commit')
        f.business.commitTransaction.mockRejectedValueOnce(error)
      if (stage === 'rollback')
        f.business.rollbackTransaction.mockRejectedValueOnce(
          new Error('rollback secret')
        )
      if (stage === 'cleanup') f.business.release.mockRejectedValueOnce(error)
      await expect(
        withAuditedApplicationWrite(f.source, application, audit, () =>
          stage === 'rollback' ? Promise.reject(error) : Promise.resolve(2000)
        )
      ).rejects.toBe(error)
      expect(f.createQueryRunner).toHaveBeenCalledTimes(1)
      expect(f.rows).toEqual([])
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'application_operation_outcome_requires_review',
          outcome: stage === 'cleanup' ? 'committed' : 'unknown'
        })
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    }
  )

  it('keeps the original error when cleanup also fails after a confirmed rollback', async () => {
    const f = fixture()
    const error = new ConflictException('original')
    f.business.release.mockRejectedValueOnce(new Error('cleanup secret'))
    await expect(
      withAuditedApplicationWrite(f.source, application, audit, () =>
        Promise.reject(error)
      )
    ).rejects.toBe(error)
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0].result).toBe('failed')
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  })

  it('can record a rejected connection attempt when a fresh connection is available', async () => {
    const f = fixture()
    const error = new Error('first connection unavailable')
    f.business.connect.mockRejectedValueOnce(error)
    await expect(
      withAuditedApplicationWrite(f.source, application, audit, () =>
        Promise.resolve()
      )
    ).rejects.toBe(error)
    expect(f.business.startTransaction).not.toHaveBeenCalled()
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0].result).toBe('failed')
    expect(f.failure.commitTransaction).toHaveBeenCalledTimes(1)
  })

  it('rejects an application mapping change before the independent audit insert', async () => {
    const f = fixture()
    const error = new ConflictException()
    f.failure.query
      .mockResolvedValueOnce([{ acquired: 1 }])
      .mockResolvedValueOnce([
        { table_prefix: 'other_app', status: 'ready', schema_version: 1 }
      ])
    await expect(
      withAuditedApplicationWrite(f.source, application, audit, () =>
        Promise.reject(error)
      )
    ).rejects.toBe(error)
    expect(f.rows).toEqual([])
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'application_failure_audit_unavailable'
      })
    )
  })
})
