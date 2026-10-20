import 'reflect-metadata'
import { randomUUID } from 'crypto'
import type { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { DataSource, QueryRunner } from 'typeorm'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { ReleaseDraftService } from '@/releases/release-draft.service'
import { ReleaseManagementService } from '@/releases/release-management.service'
import { PublishTaskWorkerService } from '@/infrastructure/tasks/publish-task-worker.service'
import { VersionService } from '@/compat/legacy/http/version/version.service'
import { OtaVersionQueryService } from '@/compat/legacy/http/version/ota-version-query.service'
import {
  PlatformType,
  ReleaseScopeType,
  UpdateType
} from '@/contracts/release-values'
import { ApplicationDataMigrator } from '@/infrastructure/migrations/application-data-migrator'
import { ApplicationTableResolver } from './application-table-resolver'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('publication transactions on isolated MySQL', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  let applications: ApplicationRegistryService
  let application: RegisteredApplication
  let drafts: ReleaseDraftService
  let legacy: VersionService
  let policy: ReleaseManagementService
  const appName = 'publishing-app'
  const context = { requestId: 'publish-test' }
  const request = { headers: {}, ip: '127.0.0.1' } as Request
  const catalog = { invalidate: jest.fn() }
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
  const query = (sql: string, args: unknown[] = []) =>
    source.query<Record<string, unknown>[]>(sql, args)
  const legacyPublish = (name = appName) =>
    legacy.create(request, {
      name,
      ver: '1.1.0',
      platform: 'windows',
      baseVersions: '1.0.0',
      installUrl: 'https://example.test/app.exe',
      enable: 1,
      mandatory: 0
    })
  const draft = async () =>
    (
      await drafts.createDraft(
        appName,
        {
          targetVersionCode: 120,
          compatibleBaseVersionCodes: [100],
          platforms: [PlatformType.Windows],
          updateType: UpdateType.Full,
          releaseScope: ReleaseScopeType.Public,
          userIds: [],
          installerSourceUrl: 'https://example.test/new.exe'
        },
        undefined,
        context
      )
    ).data.releaseId

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
    application = await applications.prepare(appName)
    policy = new ReleaseManagementService(
      source,
      applications,
      catalog as unknown as ReleaseCatalogService,
      { execute: jest.fn() } as unknown as PublishTaskWorkerService
    )
    legacy = new VersionService(
      catalog as unknown as OtaVersionQueryService,
      { get: jest.fn() } as unknown as ConfigService,
      source,
      applications,
      policy
    )
    drafts = new ReleaseDraftService(
      source,
      applications,
      catalog as unknown as ReleaseCatalogService
    )
    catalog.invalidate.mockClear()
  })
  afterEach(async () => {
    jest.restoreAllMocks()
    if (source?.isInitialized) await source.destroy()
    if (/^ota_migration_test_[a-f0-9]{32}$/.test(database))
      await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('holds allocation order through commit across legacy/v2, excludes migration and allows another application', async () => {
    const releaseId = await draft()
    await applications.prepare('other-app')
    const inserted = deferred()
    const resume = deferred()
    const competitor = deferred()
    let paused = false
    const createRunner = source.createQueryRunner.bind(
      source
    ) as DataSource['createQueryRunner']
    jest.spyOn(source, 'createQueryRunner').mockImplementation(mode => {
      const runner = createRunner(mode)
      const execute = runner.query.bind(runner) as QueryRunner['query']
      runner.query = async (
        sql: string,
        args?: unknown[],
        structured?: boolean
      ) => {
        if (paused && sql.includes('GET_LOCK') && args?.[0] !== undefined)
          competitor.resolve()
        const result: unknown = await execute(sql, args, structured)
        if (
          !paused &&
          sql.startsWith(`INSERT INTO \`${application.tables.version}\``)
        ) {
          paused = true
          inserted.resolve()
          await resume.promise
        }
        return result
      }
      return runner
    })
    const first = legacyPublish()
    let second: ReturnType<ReleaseDraftService['publish']> | undefined
    try {
      await inserted.promise // The legacy ID exists, but its transaction is not committed.
      second = drafts.publish(appName, releaseId, context)
      await competitor.promise
      expect(
        await query(`SELECT id FROM \`${application.tables.version}\``)
      ).toEqual([])
      await expect(
        new ApplicationDataMigrator(source).run({
          appName,
          tablePrefix: application.tablePrefix,
          mode: 'apply',
          batchSize: 1,
          confirmedIssuedId: 0,
          confirmBackup: true,
          confirmWritesPaused: true
        })
      ).rejects.toThrow('already running')
      expect((await legacyPublish('other-app')).code).toBe(0)
      resume.resolve()
      const [a, b] = await Promise.all([first, second])
      expect(Number(a.data.id)).toBeGreaterThanOrEqual(2000)
      expect(Number(a.data.id)).toBeLessThan(b.data.releaseSequence)
      expect(
        await query(
          `SELECT id FROM \`${application.tables.version}\` ORDER BY id`
        )
      ).toEqual([{ id: a.data.id }, { id: b.data.releaseSequence }])
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toHaveLength(2)
    } finally {
      resume.resolve()
      await Promise.allSettled([first, ...(second ? [second] : [])])
    }
  })

  it('concurrent retries of one draft allocate only one sequence and one task', async () => {
    const releaseId = await draft()
    const [a, b] = await Promise.all([
      drafts.publish(appName, releaseId, context),
      drafts.publish(appName, releaseId, context)
    ])
    expect(a.data.releaseSequence).toBe(b.data.releaseSequence)
    expect(
      await query(`SELECT id FROM \`${application.tables.version}\``)
    ).toHaveLength(1)
    expect(
      await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
    ).toHaveLength(1)
    expect(
      await query(`SELECT audit_id FROM \`${application.tables.auditLog}\``)
    ).toHaveLength(1)
  })

  it.each(['legacy', 'v2'] as const)(
    'rolls back release, task, revision and draft state when %s audit fails',
    async kind => {
      const releaseId = kind === 'v2' ? await draft() : undefined
      await query(`CREATE TRIGGER publication_fail BEFORE INSERT ON \`${application.tables.auditLog}\`
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected publication failure'`)
      const publish = () =>
        releaseId
          ? drafts.publish(appName, releaseId, context)
          : legacyPublish()
      await expect(publish()).rejects.toThrow('injected publication failure')
      expect(
        await query(`SELECT id FROM \`${application.tables.version}\``)
      ).toHaveLength(0)
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toHaveLength(0)
      expect(
        Number(
          (
            await query(
              'SELECT catalog_revision FROM ota_applications WHERE app_name = ?',
              [appName]
            )
          )[0].catalog_revision
        )
      ).toBe(0)
      expect(catalog.invalidate).not.toHaveBeenCalled()
      if (releaseId)
        expect(
          (
            await query(
              `SELECT status FROM \`${application.tables.releaseDraft}\``
            )
          )[0].status
        ).toBe('draft')
      await query('DROP TRIGGER publication_fail')
      await publish()
      expect(
        await query(`SELECT id FROM \`${application.tables.version}\``)
      ).toHaveLength(1)
    }
  )

  it('revalidates stale readiness before either publishing path allocates an ID', async () => {
    const releaseId = await draft()
    jest.spyOn(applications, 'prepare').mockResolvedValue(application)
    await query(
      "UPDATE ota_applications SET status = 'preparing' WHERE app_name = ?",
      [appName]
    )
    await expect(legacyPublish()).rejects.toThrow('not ready')
    await expect(drafts.publish(appName, releaseId, context)).rejects.toThrow(
      'not ready'
    )
    expect(
      await query(`SELECT id FROM \`${application.tables.version}\``)
    ).toHaveLength(0)
  })
})
