import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { ConfigService } from '@nestjs/config'
import { DataSource } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { DispatchProgress } from '@/realtime/dispatch/dispatch-progress'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { UpdateQueryService } from '@/updates/update-query.service'
import { Release } from '@/contracts/releases'
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import { PublishTaskWorkerService } from '@/jobs/publish/publish-task-worker.service'
import { TaskQueryService } from '@/manage/tasks/tasks.service'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('publish task checkpoints on isolated MySQL', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  let applications: ApplicationRegistryService
  let application: RegisteredApplication
  let subscriptions: ConnectionSubscriptionStore
  let sockets: Map<string, { emit: jest.Mock }>
  let taskId: string
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true
  }
  const query = (sql: string, parameters: unknown[] = []) =>
    source.query<Record<string, unknown>[]>(sql, parameters)
  const logs = () =>
    query(
      `SELECT * FROM \`${application.tables.publishTaskLog}\` ORDER BY attempt_no`
    )
  const task = async () =>
    (
      await query(
        `SELECT * FROM \`${application.tables.publishTask}\` WHERE task_id = ?`,
        [taskId]
      )
    )[0]
  const candidate: Release = {
    appName: 'task-app',
    releaseId: randomUUID(),
    releaseSequence: 2000,
    enabled: true,
    mandatory: false,
    showUpdateDialog: true,
    targetVersionCode: 110,
    compatibleBaseVersionCodes: [100],
    platforms: ['windows'],
    architectures: [],
    updateType: 'hot',
    scope: 'public',
    legacyPayload: { id: 2000, name: 'task-app', enable: 1 }
  }

  function worker(
    afterCheckpoint?: (progress: DispatchProgress) => Promise<void>
  ) {
    const catalog = {
      loadCatalog: async () => {
        const revision = Number(
          (
            await query(
              'SELECT catalog_revision FROM ota_applications WHERE app_name = ?',
              [application.appName]
            )
          )[0].catalog_revision
        )
        return {
          available: { revision, releases: [candidate] },
          audience: { revision, userIdsByReleaseId: new Map() }
        }
      }
    }
    const ws = new RealtimeGateway(
      new UpdateQueryService(catalog as unknown as ReleaseCatalogService),
      {} as never,
      subscriptions
    )
    ws.server = { sockets: { sockets } } as never
    const dispatcher: Pick<RealtimeGateway, 'dispatchApplicationUpdate'> = {
      dispatchApplicationUpdate: (name, checkpoint, revision) =>
        ws.dispatchApplicationUpdate(
          name,
          async progress => {
            const active = checkpoint ? await checkpoint(progress) : true
            if (active) await afterCheckpoint?.(progress)
            return active
          },
          revision
        )
    }
    return new PublishTaskWorkerService(
      source,
      { get: () => undefined } as unknown as ConfigService,
      applications,
      dispatcher as RealtimeGateway
    )
  }

  async function pauseAt100() {
    const reached = deferred()
    const resume = deferred()
    const running = worker(async progress => {
      if (progress.scanned === 100) {
        reached.resolve()
        await resume.promise
      }
    }).execute(application, taskId)
    await Promise.race([
      reached.promise,
      running.then(() => {
        throw new Error('Worker exited before checkpoint')
      })
    ])
    return { running, resume }
  }

  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-migration-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    database = `ota_migration_test_${randomUUID().replaceAll('-', '')}`
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({ ...connection, database })
    await source.initialize()
    const runner = source.createQueryRunner()
    try {
      await new RefactoringFoundation1792444800000().up(runner)
      await new ApplicationDataMigration1792445100000().up(runner)
    } finally {
      await runner.release()
    }
    applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    application = await applications.prepare('task-app')
    taskId = randomUUID()
    const now = new Date()
    await source
      .createQueryBuilder()
      .insert()
      .into(application.tables.publishTask)
      .values({
        task_id: taskId,
        operation_id: randomUUID(),
        action: 'redispatch',
        requested_revision: 0,
        status: 'pending',
        next_run_at: new Date(now.getTime() - 10_000),
        created_at: now,
        updated_at: now
      })
      .execute()
    subscriptions = new ConnectionSubscriptionStore()
    sockets = new Map()
    for (let index = 0; index < 205; index++) {
      const id = `socket-${index}`
      subscriptions.subscribeApplication(id, {
        appName: application.appName,
        platform: 'windows',
        nativeVersionCode: 100,
        installedReleaseSequence: 0
      })
      sockets.set(id, { emit: jest.fn().mockReturnValue(true) })
    }
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (/^ota_migration_test_[a-f0-9]{32}$/.test(database))
      await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('exposes running progress to administrators and lets only one worker claim a live task', async () => {
    const paused = await pauseAt100()
    try {
      expect(await worker().execute(application, taskId)).toBe(false)
      const detail = await new TaskQueryService(
        new AdminReadRepository(source, applications)
      ).detail(application.appName, taskId)
      expect(detail.data.latestLog).toMatchObject({
        status: 'running',
        metrics_complete: 0,
        release_summary: {
          complete: true,
          entries: [{ releaseId: candidate.releaseId, updated: 100 }]
        }
      })
      expect(Number(detail.data.latestLog?.scanned_count)).toBe(100)
      expect(detail.data.latestLog?.request_id).toMatch(/^[a-f0-9-]{36}$/)
      expect(detail.data.latestLog?.last_checkpoint_at).toBeTruthy()
      paused.resume.resolve()
      expect(await paused.running).toBe(true)
      const records = await logs()
      expect(records).toHaveLength(1)
      expect(records[0]).toMatchObject({
        status: 'succeeded',
        metrics_complete: 1
      })
      expect(Number(records[0].scanned_count)).toBe(205)
    } finally {
      paused.resume.resolve()
      await paused.running
    }
  })

  it('preserves the expired checkpoint and fences the late worker after takeover', async () => {
    const paused = await pauseAt100()
    try {
      await query(
        `UPDATE \`${application.tables.publishTask}\` SET lease_until = ? WHERE task_id = ?`,
        [new Date(0), taskId]
      )
      expect(await worker().execute(application, taskId)).toBe(true)
      const before = await logs()
      expect(before.map(row => row.status)).toEqual([
        'lease_expired',
        'succeeded'
      ])
      expect(Number(before[0].scanned_count)).toBe(100)
      expect(Number(before[1].scanned_count)).toBe(205)
      paused.resume.resolve()
      expect(await paused.running).toBe(false)
      expect(await logs()).toEqual(before)
      expect((await task()).status).toBe('succeeded')
      expect(Number((await task()).attempt_count)).toBe(2)
    } finally {
      paused.resume.resolve()
      await paused.running
    }
  })

  it('retains partial counts and retries when the catalog changes mid-flight', async () => {
    const paused = await pauseAt100()
    try {
      await query(
        'UPDATE ota_applications SET catalog_revision = 1 WHERE app_name = ?',
        [application.appName]
      )
      paused.resume.resolve()
      expect(await paused.running).toBe(false)
      const [log] = await logs()
      expect(log).toMatchObject({
        status: 'failed',
        metrics_complete: 0,
        error_code: 'catalog_revision_changed'
      })
      expect(Number(log.scanned_count)).toBe(100)
      expect((await task()).status).toBe('retry_wait')
    } finally {
      paused.resume.resolve()
      await paused.running
    }
  })

  it.each(['checkpoint', 'completion'] as const)(
    'rolls back %s errors without reporting success or exposing SQL data',
    async phase => {
      const condition =
        phase === 'checkpoint'
          ? 'NEW.scanned_count > 0'
          : "NEW.status = 'succeeded'"
      await query(`CREATE TRIGGER fail_task_progress BEFORE UPDATE ON \`${application.tables.publishTaskLog}\`
      FOR EACH ROW BEGIN IF ${condition} THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'private payload in database error'; END IF; END`)
      expect(await worker().execute(application, taskId)).toBe(false)
      const [log] = await logs()
      expect(log).toMatchObject({
        status: 'failed',
        metrics_complete: 0,
        error_code: 'dispatch_failed',
        error_summary: 'Publish dispatch failed'
      })
      expect(Number(log.scanned_count)).toBe(phase === 'checkpoint' ? 0 : 205)
      expect((await task()).status).toBe('retry_wait')
      expect(JSON.stringify(log)).not.toContain('private payload')
    }
  )

  it('counts failed send attempts separately and retries the task', async () => {
    sockets.get('socket-0')!.emit.mockReturnValue(false)
    sockets.get('socket-1')!.emit.mockImplementation(() => {
      throw new Error('private transport payload')
    })
    expect(await worker().execute(application, taskId)).toBe(false)
    const [log] = await logs()
    expect(log).toMatchObject({
      status: 'failed',
      error_code: 'emit_failed',
      metrics_complete: 0
    })
    expect(Number(log.eligible_count)).toBe(205)
    expect(Number(log.update_emit_count)).toBe(205)
    expect(Number(log.emit_error_count)).toBe(2)
    expect(JSON.stringify(log)).not.toContain('private transport')
  })

  it.each(['lease', 'revision'] as const)(
    'rechecks %s between the final checkpoint and success commit',
    async kind => {
      const running = worker(async progress => {
        if (progress.scanned !== 205) return
        if (kind === 'lease')
          await query(
            `UPDATE \`${application.tables.publishTask}\` SET lease_until = ? WHERE task_id = ?`,
            [new Date(0), taskId]
          )
        else
          await query(
            'UPDATE ota_applications SET catalog_revision = 1 WHERE app_name = ?',
            [application.appName]
          )
      })
      expect(await running.execute(application, taskId)).toBe(false)
      const [log] = await logs()
      expect(log.metrics_complete).toBe(0)
      expect(log.status).toBe(kind === 'lease' ? 'running' : 'failed')
      expect((await task()).status).not.toBe('succeeded')
      if (kind === 'lease') {
        expect(await worker().execute(application, taskId)).toBe(true)
        expect((await logs()).map(row => row.status)).toEqual([
          'lease_expired',
          'succeeded'
        ])
      }
    }
  )
})
