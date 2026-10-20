import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { WsService } from '@/ws/ws.service'
import { PublishTaskWorkerService } from './publish-task-worker.service'

function fixture(snapshotRevision = 42, revisionAfterClaim = 42) {
  const tables = new ApplicationTableResolver().resolve('app', 'app')
  const application: RegisteredApplication = {
    appName: 'app',
    tablePrefix: 'app',
    schemaVersion: 1,
    status: 'ready',
    tables
  }
  let currentRevision = 42
  const task: Record<string, unknown> = {
    task_id: 'task-a',
    status: 'pending',
    attempt_count: 0,
    lease_token: 0,
    max_attempts: 5,
    next_run_at: new Date(0)
  }
  const log: Record<string, unknown> = {}
  const writes: Array<{ table: string; values: Record<string, unknown> }> = []
  const source = {
    createQueryRunner: () => {
      const runner = {
        isTransactionActive: false,
        connect: jest.fn(),
        release: jest.fn(),
        startTransaction: jest.fn(() => {
          runner.isTransactionActive = true
        }),
        commitTransaction: jest.fn(() => {
          runner.isTransactionActive = false
        }),
        rollbackTransaction: jest.fn(() => {
          runner.isTransactionActive = false
        }),
        manager: {
          createQueryBuilder: () => {
            let table = ''
            let values: Record<string, unknown> = {}
            const builder = {
              select: jest.fn().mockReturnThis(),
              setLock: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              insert: jest.fn().mockReturnThis(),
              from: (name: string) => {
                table = name
                return builder
              },
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
              getRawOne: () =>
                Promise.resolve(
                  table === 'ota_applications'
                    ? { catalogRevision: currentRevision }
                    : { ...task }
                ),
              execute: () => {
                writes.push({ table, values })
                Object.assign(table === tables.publishTask ? task : log, values)
                return Promise.resolve({ affected: 1 })
              }
            }
            return builder
          }
        }
      }
      return runner
    }
  }
  const query = {
    loadCatalog: jest.fn(() => {
      currentRevision = revisionAfterClaim
      return Promise.resolve({
        available: { revision: snapshotRevision, releases: [] },
        audience: { revision: snapshotRevision, userIdsByReleaseId: new Map() }
      })
    })
  }
  const ws = new WsService(
    query as never,
    {} as never,
    new ConnectionSubscriptionStore()
  )
  const worker = new PublishTaskWorkerService(
    source as unknown as DataSource,
    { get: () => undefined } as unknown as ConfigService,
    {} as ApplicationRegistryService,
    ws
  )
  return { worker, application, task, log, writes, tables, query }
}

describe('PublishTaskWorkerService snapshot revision', () => {
  it('completes an empty batch with the revision actually used by dispatch', async () => {
    const f = fixture()
    await expect(
      f.worker.execute(f.application, 'task-a', 'request-a')
    ).resolves.toBe(true)
    expect(f.query.loadCatalog).toHaveBeenCalledWith('app', true)
    expect(f.log).toMatchObject({
      status: 'succeeded',
      effective_revision: 42,
      metrics_complete: 1,
      scanned_count: 0,
      update_emit_count: 0,
      request_id: 'request-a'
    })
    expect(f.task.status).toBe('succeeded')
    expect(
      f.writes.filter(
        write =>
          write.table === f.tables.publishTask &&
          write.values.lease_until instanceof Date
      )
    ).toHaveLength(3)
  })

  it.each([
    { snapshot: 41, current: 42 },
    { snapshot: 43, current: 43 },
    { snapshot: 42, current: 43 }
  ])(
    'retries instead of marking an empty batch successful on revision drift: %j',
    async ({ snapshot, current }) => {
      const f = fixture(snapshot, current)
      await expect(f.worker.execute(f.application, 'task-a')).resolves.toBe(
        false
      )
      expect(f.task.status).toBe('retry_wait')
      expect(f.log).toMatchObject({
        status: 'failed',
        effective_revision: 42,
        metrics_complete: 0,
        error_code: 'catalog_revision_changed'
      })
      expect(f.writes.some(write => write.values.status === 'succeeded')).toBe(
        false
      )
    }
  )
})
