import 'reflect-metadata'
import { randomUUID } from 'crypto'
import type { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { Logger } from '@nestjs/common'
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
import { DualWriteReleaseRepository } from '@/compat/legacy/persistence/dual-write-release.repository'
import { inspectBackfillRow } from '@/compat/legacy/persistence/backfill-row'
import { AuditQueryService } from '@/audit/audit-query.service'
import { AdminReadRepository } from './admin-read.repository'

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
  const request = {
    headers: { 'x-request-id': 'legacy-publish-test' },
    ip: '127.0.0.1',
    user: { sub: 17, username: 'legacy-operator' }
  } as unknown as Request
  const catalog = { invalidate: jest.fn() }
  const worker = { execute: jest.fn() }
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
  const legacyPublish = (name = appName, userIds: string[] = []) =>
    legacy.create(request, {
      name,
      ver: '1.1.0',
      platform: 'windows',
      baseVersions: '1.0.0',
      installUrl: 'https://example.test/app.exe',
      enable: 1,
      mandatory: 0,
      releaseScope: userIds.length
        ? ReleaseScopeType.Allowlist
        : ReleaseScopeType.Public,
      userIds
    })
  const draft = async (userIds: string[] = []) =>
    (
      await drafts.createDraft(
        appName,
        {
          targetVersionCode: 120,
          compatibleBaseVersionCodes: [100],
          platforms: [PlatformType.Windows],
          updateType: UpdateType.Full,
          releaseScope: userIds.length
            ? ReleaseScopeType.Allowlist
            : ReleaseScopeType.Public,
          userIds,
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
      worker as unknown as PublishTaskWorkerService,
      new DualWriteReleaseRepository()
    )
    legacy = new VersionService(
      catalog as unknown as OtaVersionQueryService,
      { get: jest.fn() } as unknown as ConfigService,
      source,
      applications,
      policy,
      new DualWriteReleaseRepository()
    )
    drafts = new ReleaseDraftService(
      source,
      applications,
      catalog as unknown as ReleaseCatalogService,
      new DualWriteReleaseRepository()
    )
    catalog.invalidate.mockClear()
    worker.execute.mockReset()
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
      const intercepted = async (
        sql: string,
        args?: unknown[],
        structured?: boolean
      ) => {
        if (paused && sql.includes('GET_LOCK') && args?.[0] !== undefined)
          competitor.resolve()
        const result: unknown = structured
          ? await execute(sql, args, true)
          : await execute(sql, args)
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
      // Forward the original overload's structured/raw result without changing it.
      runner.query = intercepted as QueryRunner['query']
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
      await query(
        `SELECT audit_id FROM \`${application.tables.auditLog}\` WHERE action = 'publish'`
      )
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

  it('both writers reconcile after formal cutover and policy changes keep the columns synchronized', async () => {
    const old = await legacyPublish()
    expect(old.data).toMatchObject({
      ver: 110,
      baseVersions: '100',
      enable: 1,
      mandatory: 0
    })
    const releaseId = await draft()
    await drafts.publish(appName, releaseId, context)
    const records = await query(
      `SELECT * FROM \`${application.tables.version}\` ORDER BY id`
    )
    expect(records.map(row => inspectBackfillRow('version', row))).toEqual([
      { patch: {}, issues: [] },
      { patch: {}, issues: [] }
    ])
    expect(records[0].compatible_base_version_codes).toEqual([110, 100])
    expect(records[1].compatible_base_version_codes).toEqual([100])
    await new ApplicationDataMigrator(source).run({
      appName,
      tablePrefix: application.tablePrefix,
      mode: 'apply',
      batchSize: 1,
      confirmedIssuedId: 5000,
      confirmBackup: true,
      confirmWritesPaused: true,
      activateFormal: true
    })
    await policy.setEnabled(appName, releaseId, false, context)
    const disabled = (
      await query(
        `SELECT enable, is_enabled FROM \`${application.tables.version}\` WHERE release_id = ?`,
        [releaseId]
      )
    )[0]
    expect(disabled).toEqual({ enable: 0, is_enabled: 0 })
    const actualCatalog = new ReleaseCatalogService(source, applications)
    expect(
      (await actualCatalog.loadCatalog(appName)).available.releases.find(
        row => row.releaseId === releaseId
      )?.enabled
    ).toBe(false)
    expect((await legacyPublish()).data.id).toBe(5001)
  })

  const rejectSuccessAudit = () =>
    query(
      `CREATE TRIGGER reject_success_audit BEFORE INSERT ON \`${application.tables.auditLog}\`
     FOR EACH ROW BEGIN
       IF NEW.result = 'succeeded' THEN
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected secret SQL payload';
       END IF;
     END`
    )
  const auditRows = () =>
    query(
      `SELECT * FROM \`${application.tables.auditLog}\` WHERE action NOT IN ('draft_created', 'draft_updated') ORDER BY created_at, audit_id`
    )

  it.each(['legacy', 'v2'] as const)(
    'persists an independent failed %s publication audit after complete rollback',
    async kind => {
      const releaseId = kind === 'v2' ? await draft() : undefined
      await rejectSuccessAudit()
      await expect(
        releaseId
          ? drafts.publish(appName, releaseId, context)
          : legacyPublish()
      ).rejects.toThrow('injected secret SQL payload')
      expect(
        await query(`SELECT id FROM \`${application.tables.version}\``)
      ).toEqual([])
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toEqual([])
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
      const rows = await auditRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        action: 'publish',
        result: 'failed',
        error_code: 'DATABASE_WRITE_FAILED',
        task_id: null,
        revision_before: null,
        revision_after: null,
        change_summary: { source: kind === 'legacy' ? 'legacy-http' : 'v2' }
      })
      expect(JSON.stringify(rows)).not.toMatch(/secret|payload|example\.test/)
      if (kind === 'legacy') {
        expect(rows[0]).toMatchObject({
          request_id: 'legacy-publish-test',
          actor_admin_id: 17,
          actor_name_snapshot: 'legacy-operator',
          actor_type: 'admin'
        })
      }
      if (releaseId) {
        expect(rows[0].release_id).toBe(releaseId)
        expect(
          (
            await query(
              `SELECT status FROM \`${application.tables.releaseDraft}\``
            )
          )[0].status
        ).toBe('draft')
      }
      expect(catalog.invalidate).not.toHaveBeenCalled()
      await query('DROP TRIGGER reject_success_audit')
      if (releaseId) await drafts.publish(appName, releaseId, context)
      else await legacyPublish()
      expect((await auditRows()).map(row => row.result).sort()).toEqual([
        'failed',
        'succeeded'
      ])
    }
  )

  it.each(['enable', 'disable', 'redispatch', 'users', 'scope'] as const)(
    'rolls back %s mutations and exposes the failed audit to administrators, then permits a clean retry',
    async action => {
      const releaseId = await draft()
      await drafts.publish(appName, releaseId, context)
      const before = (
        await query(`SELECT * FROM \`${application.tables.version}\``)
      )[0]
      catalog.invalidate.mockClear()
      const operationContext = {
        requestId: `failed-${action}`,
        actorAdminId: 7,
        actorName: 'operator',
        sourceIp: '127.0.0.1'
      }
      const mutate = () => {
        if (action === 'enable' || action === 'disable')
          return policy.setEnabled(
            appName,
            releaseId,
            action === 'enable',
            operationContext
          )
        if (action === 'redispatch')
          return policy.redispatch(appName, releaseId, operationContext)
        if (action === 'users')
          return policy.replaceUsers(
            appName,
            releaseId,
            { userIds: [`${appName}:windows:private-user`] },
            operationContext
          )
        return policy.changeScope(
          appName,
          releaseId,
          { releaseScope: ReleaseScopeType.Allowlist },
          operationContext
        )
      }
      await rejectSuccessAudit()
      await expect(mutate()).rejects.toThrow('injected secret SQL payload')
      expect(
        (await query(`SELECT * FROM \`${application.tables.version}\``))[0]
      ).toEqual(before)
      expect(
        await query(`SELECT * FROM \`${application.tables.releaseUser}\``)
      ).toEqual([])
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toHaveLength(1)
      expect(
        Number(
          (
            await query(
              'SELECT catalog_revision FROM ota_applications WHERE app_name = ?',
              [appName]
            )
          )[0].catalog_revision
        )
      ).toBe(1)
      expect(catalog.invalidate).not.toHaveBeenCalled()
      expect(worker.execute).not.toHaveBeenCalled()
      const read = new AuditQueryService(
        new AdminReadRepository(source, applications)
      )
      const page = await read.listApplication(appName, {
        result: 'failed',
        requestId: operationContext.requestId,
        releaseId,
        // DATETIME(0) can round inserts into the following second.
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString()
      })
      expect(page.data.data).toHaveLength(1)
      expect(page.data.data[0]).toMatchObject({
        result: 'failed',
        error_code: 'DATABASE_WRITE_FAILED',
        actor_admin_id: 7,
        request_id: operationContext.requestId,
        release_id: releaseId,
        task_id: null,
        revision_before: null,
        revision_after: null
      })
      expect(JSON.stringify(page)).not.toMatch(/secret|private-user/)
      await query('DROP TRIGGER reject_success_audit')
      await mutate()
      const attempts = (await auditRows()).filter(
        row => row.request_id === operationContext.requestId
      )
      expect(attempts.map(row => row.result).sort()).toEqual([
        'failed',
        'succeeded'
      ])
      expect(new Set(attempts.map(row => row.operation_id)).size).toBe(2)
    }
  )

  it('audits revision conflicts, invalid audiences and wrong-application IDs without storing user input', async () => {
    const releaseId = await draft()
    await drafts.publish(appName, releaseId, context)
    await expect(
      policy.replaceUsers(
        appName,
        releaseId,
        { expectedRevision: 99, userIds: [] },
        { requestId: 'conflict' }
      )
    ).rejects.toThrow('revision has changed')
    await expect(
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: ['other:windows:secret-user'] },
        { requestId: 'invalid-users' }
      )
    ).rejects.toThrow('audience is invalid')
    const other = await applications.prepare('other-app')
    await expect(
      policy.setEnabled('other-app', releaseId, false, {
        requestId: 'wrong-app'
      })
    ).rejects.toThrow('does not exist')
    const rows = await auditRows()
    expect(rows.find(row => row.request_id === 'conflict')).toMatchObject({
      result: 'failed',
      error_code: 'OPERATION_CONFLICT'
    })
    expect(rows.find(row => row.request_id === 'invalid-users')).toMatchObject({
      result: 'failed',
      error_code: 'INVALID_OPERATION'
    })
    expect(rows.some(row => row.request_id === 'wrong-app')).toBe(false)
    expect(
      await query(`SELECT result, error_code FROM \`${other.tables.auditLog}\``)
    ).toEqual([{ result: 'failed', error_code: 'RELEASE_NOT_FOUND' }])
    expect(JSON.stringify(rows)).not.toContain('secret-user')
    expect(
      (
        await query(
          `SELECT policy_revision FROM \`${application.tables.version}\``
        )
      )[0].policy_revision
    ).toBe(1)
  })

  it('records draft-audience failures after rollback without creating a publish task', async () => {
    const releaseId = await draft()
    const before = (
      await query(`SELECT * FROM \`${application.tables.releaseDraft}\``)
    )[0]
    await rejectSuccessAudit()
    await expect(
      policy.changeScope(
        appName,
        releaseId,
        { releaseScope: ReleaseScopeType.Allowlist },
        context
      )
    ).rejects.toThrow('injected secret SQL payload')
    expect(
      (await query(`SELECT * FROM \`${application.tables.releaseDraft}\``))[0]
    ).toEqual(before)
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        action: 'draft_audience_changed',
        target_type: 'release_draft',
        result: 'failed',
        task_id: null
      })
    ])
    expect(
      await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
    ).toEqual([])
    await query('DROP TRIGGER reject_success_audit')
    await policy.changeScope(
      appName,
      releaseId,
      { releaseScope: ReleaseScopeType.Allowlist },
      context
    )
    await expect(
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: ['other:windows:secret-user'] },
        context
      )
    ).rejects.toThrow('audience is invalid')
    expect(
      (await auditRows()).filter(row => row.result === 'failed')
    ).toHaveLength(2)
    expect(JSON.stringify(await auditRows())).not.toContain('secret-user')
  })

  it('keeps only the committed success audit if post-commit dispatch fails', async () => {
    const releaseId = await draft()
    await drafts.publish(appName, releaseId, context)
    worker.execute.mockRejectedValueOnce(new Error('dispatch failed'))
    await expect(
      policy.setEnabled(appName, releaseId, false, context)
    ).rejects.toThrow('dispatch failed')
    expect(
      (
        await query(
          `SELECT enable, is_enabled, policy_revision FROM \`${application.tables.version}\``
        )
      )[0]
    ).toEqual({ enable: 0, is_enabled: 0, policy_revision: 2 })
    expect((await auditRows()).map(row => row.result)).toEqual([
      'succeeded',
      'succeeded'
    ])
  })

  const audienceIds = (prefix: string, count: number) =>
    Array.from(
      { length: count },
      (_, i) => `${appName}:windows:${prefix}-${i.toString().padStart(5, '0')}`
    )
  const partsFor = (requestId: string) =>
    query(
      `SELECT * FROM \`${application.tables.auditLog}\` WHERE request_id = ? ORDER BY part_no`,
      [requestId]
    )
  const details = (rows: Record<string, unknown>[]) =>
    rows.map(
      row =>
        row.change_detail as {
          addedUserIds: string[]
          removedUserIds: string[]
        }
    )
  const storedUsers = (releaseId: string) =>
    query(
      `SELECT user_id FROM \`${application.tables.releaseUser}\` WHERE release_id = ? ORDER BY user_id`,
      [releaseId]
    )

  it.each(['legacy', 'v2'] as const)(
    'audits every initial audience member in a segmented %s publication',
    async kind => {
      const userIds = audienceIds('initial', 401)
      const releaseId = kind === 'v2' ? await draft(userIds) : undefined
      const publish = () =>
        releaseId
          ? drafts.publish(appName, releaseId, context)
          : legacyPublish(appName, userIds)
      await query(`CREATE TRIGGER publication_part_fail BEFORE INSERT ON \`${application.tables.auditLog}\`
        FOR EACH ROW BEGIN IF NEW.part_no = 2 AND NEW.result = 'succeeded' THEN
          SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'publication second part failed'; END IF; END`)
      await expect(publish()).rejects.toThrow('publication second part failed')
      expect(
        await query(`SELECT id FROM \`${application.tables.version}\``)
      ).toEqual([])
      expect(
        await query(`SELECT user_id FROM \`${application.tables.releaseUser}\``)
      ).toEqual([])
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toEqual([])
      expect(await auditRows()).toEqual([
        expect.objectContaining({ result: 'failed', change_detail: null })
      ])
      await query('DROP TRIGGER publication_part_fail')
      await publish()
      const rows = (await auditRows())
        .filter(row => row.result === 'succeeded')
        .sort((a, b) => Number(a.part_no) - Number(b.part_no))
      expect(rows.map(row => row.part_no)).toEqual([1, 2, 3])
      expect(new Set(rows.map(row => row.operation_id)).size).toBe(1)
      expect(new Set(rows.map(row => row.task_id)).size).toBe(1)
      expect(rows[0].change_summary).toMatchObject({
        audience: {
          scopeBefore: null,
          scopeAfter: 'allowlist',
          addedCount: 401,
          removedCount: 0,
          partCount: 3
        }
      })
      expect(details(rows).flatMap(part => part.addedUserIds)).toEqual(userIds)
      expect(details(rows).flatMap(part => part.removedUserIds)).toEqual([])
    }
  )

  it('audits all 10000 membership changes and allows paginated administrator reconstruction', async () => {
    const before = audienceIds('old', 5000)
    const after = audienceIds('new', 5000)
    const releaseId = await draft(before)
    await drafts.publish(appName, releaseId, context)
    await policy.replaceUsers(
      appName,
      releaseId,
      { userIds: after, expectedRevision: 1 },
      { requestId: 'bulk-replace' }
    )
    const rows = await partsFor('bulk-replace')
    expect(rows.map(row => row.part_no)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1)
    )
    expect(new Set(rows.map(row => row.operation_id)).size).toBe(1)
    expect(new Set(rows.map(row => row.task_id)).size).toBe(1)
    expect(
      details(rows).every(
        part => part.addedUserIds.length + part.removedUserIds.length <= 200
      )
    ).toBe(true)
    expect(details(rows).flatMap(part => part.addedUserIds)).toEqual(after)
    expect(details(rows).flatMap(part => part.removedUserIds)).toEqual(before)
    expect((await storedUsers(releaseId)).map(row => row.user_id)).toEqual(
      after
    )
    for (const row of rows) {
      expect(row).toMatchObject({
        result: 'succeeded',
        revision_before: '1',
        revision_after: '2'
      })
      expect(row.change_summary).toMatchObject({
        audience: { addedCount: 5000, removedCount: 5000, partCount: 50 }
      })
    }
    const read = new AuditQueryService(
      new AdminReadRepository(source, applications)
    )
    const retrieved: Record<string, unknown>[] = []
    for (let page = 1; page <= 8; page++) {
      const result = await read.listApplication(appName, {
        operationId: String(rows[0].operation_id),
        page: String(page),
        pageSize: '7',
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString()
      })
      expect(result.data.total).toBe(50)
      retrieved.push(...result.data.data)
    }
    expect(new Set(retrieved.map(row => row.audit_id)).size).toBe(50)
    expect(
      retrieved.map(row => Number(row.part_no)).sort((a, b) => a - b)
    ).toEqual(rows.map(row => row.part_no))
    expect(
      details(retrieved)
        .flatMap(part => part.addedUserIds)
        .sort()
    ).toEqual(after)
    const other = await applications.prepare('other-app')
    expect(
      (
        await read.listApplication(other.appName, {
          operationId: String(rows[0].operation_id)
        })
      ).data.total
    ).toBe(0)
  })

  it('records exact removals when switching to public and a complete empty part for unchanged membership', async () => {
    const userIds = audienceIds('member', 201)
    const releaseId = await draft(userIds)
    await drafts.publish(appName, releaseId, context)
    await policy.replaceUsers(
      appName,
      releaseId,
      { userIds: [...userIds].reverse() },
      { requestId: 'unchanged' }
    )
    const unchanged = await partsFor('unchanged')
    expect(unchanged).toHaveLength(1)
    expect(unchanged[0].change_detail).toEqual({
      addedUserIds: [],
      removedUserIds: []
    })
    await policy.changeScope(
      appName,
      releaseId,
      { releaseScope: ReleaseScopeType.Public },
      { requestId: 'public' }
    )
    const cleared = await partsFor('public')
    expect(cleared).toHaveLength(2)
    expect(cleared[0].change_summary).toMatchObject({
      audience: {
        scopeBefore: 'allowlist',
        scopeAfter: 'public',
        addedCount: 0,
        removedCount: 201
      }
    })
    expect(details(cleared).flatMap(part => part.removedUserIds)).toEqual(
      userIds
    )
    expect(await storedUsers(releaseId)).toEqual([])
  })

  it('rolls back the whole audience, revision, task and earlier audit parts when part two fails', async () => {
    const original = audienceIds('original', 1)
    const releaseId = await draft(original)
    await drafts.publish(appName, releaseId, context)
    catalog.invalidate.mockClear()
    await query(`CREATE TRIGGER fail_audit_part BEFORE INSERT ON \`${application.tables.auditLog}\`
      FOR EACH ROW BEGIN IF NEW.part_no = 2 AND NEW.result = 'succeeded' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'second part failed'; END IF; END`)
    const mutate = () =>
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: audienceIds('replacement', 401) },
        { requestId: 'part-failure' }
      )
    await expect(mutate()).rejects.toThrow('second part failed')
    expect((await storedUsers(releaseId)).map(row => row.user_id)).toEqual(
      original
    )
    expect(
      (
        await query(
          `SELECT policy_revision FROM \`${application.tables.version}\``
        )
      )[0].policy_revision
    ).toBe(1)
    expect(
      Number(
        (
          await query(
            'SELECT catalog_revision FROM ota_applications WHERE app_name = ?',
            [appName]
          )
        )[0].catalog_revision
      )
    ).toBe(1)
    expect(
      await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
    ).toHaveLength(1)
    const failed = await partsFor('part-failure')
    expect(failed).toHaveLength(1)
    expect(failed[0]).toMatchObject({
      result: 'failed',
      part_no: 1,
      change_detail: null,
      task_id: null
    })
    expect(catalog.invalidate).not.toHaveBeenCalled()
    expect(worker.execute).not.toHaveBeenCalled()
    await query('DROP TRIGGER fail_audit_part')
    await mutate()
    expect(
      (await partsFor('part-failure')).filter(row => row.result === 'succeeded')
    ).toHaveLength(3)
  })

  it('audits draft audience replacement and public clearing without creating tasks', async () => {
    const releaseId = await draft(audienceIds('old', 201))
    const replacement = audienceIds('new', 201)
    await policy.replaceUsers(
      appName,
      releaseId,
      { userIds: replacement },
      { requestId: 'draft-replace' }
    )
    const rows = await partsFor('draft-replace')
    expect(rows).toHaveLength(3)
    for (const row of rows)
      expect(row).toMatchObject({
        target_type: 'release_draft',
        action: 'draft_audience_changed',
        task_id: null
      })
    expect(details(rows).flatMap(part => part.addedUserIds)).toEqual(
      replacement
    )
    expect(details(rows).flatMap(part => part.removedUserIds)).toEqual(
      audienceIds('old', 201)
    )
    await policy.changeScope(
      appName,
      releaseId,
      { releaseScope: ReleaseScopeType.Public },
      { requestId: 'draft-public' }
    )
    expect(
      details(await partsFor('draft-public')).flatMap(
        part => part.removedUserIds
      )
    ).toEqual(replacement)
    expect(
      await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
    ).toEqual([])
  })

  it('rolls back the draft payload and every earlier audit part when a later draft part fails', async () => {
    const releaseId = await draft(audienceIds('old', 201))
    const before = await query(
      `SELECT * FROM \`${application.tables.releaseDraft}\``
    )
    await query(`CREATE TRIGGER draft_part_fail BEFORE INSERT ON \`${application.tables.auditLog}\`
      FOR EACH ROW BEGIN IF NEW.part_no = 2 AND NEW.result = 'succeeded' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'draft second part failed'; END IF; END`)
    await expect(
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: audienceIds('new', 201) },
        { requestId: 'draft-part-failure' }
      )
    ).rejects.toThrow('draft second part failed')
    expect(
      await query(`SELECT * FROM \`${application.tables.releaseDraft}\``)
    ).toEqual(before)
    expect(await auditRows()).toEqual([
      expect.objectContaining({
        result: 'failed',
        action: 'draft_audience_changed',
        change_detail: null
      })
    ])
    expect(
      await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
    ).toEqual([])
    await query('DROP TRIGGER draft_part_fail')
    await policy.replaceUsers(
      appName,
      releaseId,
      { userIds: audienceIds('new', 201) },
      { requestId: 'draft-part-retry' }
    )
    expect(await partsFor('draft-part-retry')).toHaveLength(3)
  })

  it('rejects oversized requests and historical lists without partially replacing or clearing them', async () => {
    const releaseId = await draft()
    await drafts.publish(appName, releaseId, context)
    await expect(
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: audienceIds('new', 5001) },
        { requestId: 'oversized-request' }
      )
    ).rejects.toThrow('audience is invalid')
    expect(await storedUsers(releaseId)).toEqual([])
    await source
      .createQueryBuilder()
      .insert()
      .into(application.tables.releaseUser, [
        'release_id',
        'user_id',
        'created_at'
      ])
      .values(
        audienceIds('historical', 5001).map(userId => ({
          release_id: releaseId,
          user_id: userId,
          created_at: new Date()
        }))
      )
      .execute()
    await expect(
      policy.changeScope(
        appName,
        releaseId,
        { releaseScope: ReleaseScopeType.Public },
        { requestId: 'oversized-stored' }
      )
    ).rejects.toThrow('audit limit')
    expect(await storedUsers(releaseId)).toHaveLength(5001)
    expect((await partsFor('oversized-request'))[0]).toMatchObject({
      result: 'failed',
      error_code: 'INVALID_OPERATION',
      change_detail: null
    })
    expect((await partsFor('oversized-stored'))[0]).toMatchObject({
      result: 'failed',
      error_code: 'OPERATION_CONFLICT',
      change_detail: null
    })
    expect(
      (
        await query(
          `SELECT policy_revision FROM \`${application.tables.version}\``
        )
      )[0].policy_revision
    ).toBe(1)
  })

  it('uses the locked audience snapshot for concurrent revision-checked replacements', async () => {
    const releaseId = await draft(audienceIds('original', 1))
    await drafts.publish(appName, releaseId, context)
    const results = await Promise.allSettled([
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: audienceIds('first', 201), expectedRevision: 1 },
        { requestId: 'racing-first' }
      ),
      policy.replaceUsers(
        appName,
        releaseId,
        { userIds: audienceIds('second', 201), expectedRevision: 1 },
        { requestId: 'racing-second' }
      )
    ])
    expect(
      results.filter(result => result.status === 'fulfilled')
    ).toHaveLength(1)
    const winner = results[0].status === 'fulfilled' ? 'first' : 'second'
    const loser = winner === 'first' ? 'second' : 'first'
    const rows = await partsFor(`racing-${winner}`)
    expect(details(rows).flatMap(part => part.addedUserIds)).toEqual(
      audienceIds(winner, 201)
    )
    expect(details(rows).flatMap(part => part.removedUserIds)).toEqual(
      audienceIds('original', 1)
    )
    expect(await partsFor(`racing-${loser}`)).toEqual([
      expect.objectContaining({
        result: 'failed',
        error_code: 'OPERATION_CONFLICT'
      })
    ])
  })

  it.each(['commit-ack', 'unlock'] as const)(
    'does not invent a failed publication after a successful commit and lost %s response',
    async stage => {
      const releaseId = await draft()
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined)
      const createRunner = source.createQueryRunner.bind(
        source
      ) as DataSource['createQueryRunner']
      let injected = false
      let wroteRelease = false
      jest.spyOn(source, 'createQueryRunner').mockImplementation(mode => {
        const runner = createRunner(mode)
        const execute = runner.query.bind(runner) as QueryRunner['query']
        runner.query = (async (
          sql: string,
          args?: unknown[],
          structured?: boolean
        ) => {
          const result: unknown = structured
            ? await execute(sql, args, true)
            : await execute(sql, args)
          if (sql.startsWith(`INSERT INTO \`${application.tables.version}\``))
            wroteRelease = true
          if (
            !injected &&
            wroteRelease &&
            (stage === 'commit-ack'
              ? sql === 'COMMIT'
              : sql.includes('RELEASE_LOCK'))
          ) {
            injected = true
            throw new Error('lost response secret')
          }
          return result
        }) as QueryRunner['query']
        return runner
      })
      await expect(drafts.publish(appName, releaseId, context)).rejects.toThrow(
        'lost response secret'
      )
      expect(injected).toBe(true)
      expect((await auditRows()).map(row => row.result)).toEqual(['succeeded'])
      expect(
        await query(`SELECT task_id FROM \`${application.tables.publishTask}\``)
      ).toHaveLength(1)
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'application_operation_outcome_requires_review',
          outcome: stage === 'commit-ack' ? 'unknown' : 'committed'
        })
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
      await drafts.publish(appName, releaseId, context)
      expect(await auditRows()).toHaveLength(1)
    }
  )
})
