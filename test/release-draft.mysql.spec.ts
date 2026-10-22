import 'reflect-metadata'
import { Logger } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { AuditQueryService } from '@/manage/audit/audit.service'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { DualWriteReleaseRepository } from '@/infrastructure/persistence/legacy/dual-write-release.repository'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import {
  PlatformType,
  ReleaseScopeType,
  UpdateType
} from '@/contracts/release-values'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { CreateReleaseDraftDto } from '@/releases/release-draft.dto'
import { ReleaseDraftService } from '@/releases/release-draft.service'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip

mysql('draft creation and editing audits on isolated MySQL', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  let applications: ApplicationRegistryService
  let application: RegisteredApplication
  let drafts: ReleaseDraftService
  const appName = 'draft-app'
  const catalog = { invalidate: jest.fn() }
  const context = (requestId: string) => ({
    requestId,
    actorAdminId: 7,
    actorName: 'operator',
    sourceIp: '127.0.0.1'
  })
  const members = (prefix: string, count: number) =>
    Array.from(
      { length: count },
      (_, i) => `${appName}:windows:${prefix}-${i.toString().padStart(4, '0')}`
    )
  const body = (userIds: string[] = []): CreateReleaseDraftDto => ({
    targetVersionCode: 120,
    compatibleBaseVersionCodes: [100],
    platforms: [PlatformType.Windows],
    updateType: UpdateType.Full,
    releaseScope: userIds.length
      ? ReleaseScopeType.Allowlist
      : ReleaseScopeType.Public,
    userIds,
    installerSourceUrl: 'https://example.test/installer.exe?token=url-secret',
    releaseNotes: 'notes-secret'
  })
  const query = (sql: string, args: unknown[] = []) =>
    source.query<Record<string, unknown>[]>(sql, args)
  const rows = () =>
    query(`SELECT * FROM \`${application.tables.releaseDraft}\``)
  const audits = (requestId?: string) =>
    query(
      `SELECT * FROM \`${application.tables.auditLog}\` ${requestId ? 'WHERE request_id = ?' : ''} ORDER BY part_no`,
      requestId ? [requestId] : []
    )
  const create = (userIds: string[] = [], key?: string) =>
    drafts.createDraft(appName, body(userIds), key, context('create'))
  const rejectPartTwo = () =>
    query(`CREATE TRIGGER reject_part_two BEFORE INSERT ON \`${application.tables.auditLog}\`
    FOR EACH ROW BEGIN IF NEW.part_no = 2 AND NEW.result = 'succeeded' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'second audit part failed'; END IF; END`)
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
    drafts = new ReleaseDraftService(
      source,
      applications,
      catalog as unknown as ReleaseCatalogService,
      new DualWriteReleaseRepository()
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

  it('creates a draft and all audit parts atomically and exposes only allowlisted metadata to administrators', async () => {
    const userIds = members('initial', 401)
    const result = await drafts.createDraft(
      appName,
      {
        ...body(userIds),
        ignoredPassword: 'password-secret'
      } as CreateReleaseDraftDto,
      'idempotency-secret',
      context('create')
    )
    const records = await audits('create')
    expect(records.map(row => row.part_no)).toEqual([1, 2, 3])
    expect(new Set(records.map(row => row.operation_id)).size).toBe(1)
    for (const row of records)
      expect(row).toMatchObject({
        action: 'draft_created',
        target_type: 'release_draft',
        release_id: result.data.releaseId,
        result: 'succeeded',
        actor_admin_id: 7,
        task_id: null,
        revision_before: null,
        revision_after: null
      })
    expect(records[0].change_summary).toMatchObject({
      audience: { partCount: 3, addedCount: 401, removedCount: 0 }
    })
    expect(
      (records[0].change_summary as { changedFields: string[] }).changedFields
    ).toEqual(
      expect.arrayContaining(['userIds', 'releaseNotes', 'installerSourceUrl'])
    )
    expect(
      records.flatMap(
        row => (row.change_detail as { addedUserIds: string[] }).addedUserIds
      )
    ).toEqual(userIds)
    expect(JSON.stringify(records)).not.toMatch(
      /notes-secret|url-secret|password-secret|ignoredPassword|idempotency-secret/
    )
    const page = await new AuditQueryService(
      new AdminReadRepository(source, applications)
    ).listApplication(appName, {
      action: 'draft_created',
      releaseId: result.data.releaseId,
      from: new Date(Date.now() - 60_000).toISOString(),
      to: new Date(Date.now() + 60_000).toISOString()
    })
    expect(page.data.total).toBe(3)
    expect(
      await query(`SELECT * FROM \`${application.tables.publishTask}\``)
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
    expect(catalog.invalidate).not.toHaveBeenCalled()
  })

  it('replays concurrent create retries despite MySQL object-key reordering without duplicate successful audits', async () => {
    const input = body()
    const reordered = Object.fromEntries(
      Object.entries(input).reverse()
    ) as unknown as CreateReleaseDraftDto
    const [first, second] = await Promise.all([
      drafts.createDraft(appName, input, 'same-key', context('first')),
      drafts.createDraft(appName, reordered, 'same-key', context('second'))
    ])
    expect(first.data.releaseId).toBe(second.data.releaseId)
    expect(await rows()).toHaveLength(1)
    expect(await audits()).toHaveLength(1)
    await expect(
      drafts.createDraft(
        appName,
        { ...input, targetVersionCode: 121 },
        'same-key',
        context('conflict')
      )
    ).rejects.toThrow('different content')
    expect(await audits('conflict')).toEqual([
      expect.objectContaining({
        result: 'failed',
        error_code: 'OPERATION_CONFLICT',
        release_id: first.data.releaseId,
        action: 'draft_created'
      })
    ])
    expect(
      (await audits()).filter(row => row.result === 'succeeded')
    ).toHaveLength(1)
  })

  it('keeps the same create key isolated across applications', async () => {
    const first = await create([], 'shared-key')
    const second = await drafts.createDraft(
      'other-app',
      body(),
      'shared-key',
      context('other')
    )
    expect(first.data.releaseId).not.toBe(second.data.releaseId)
    const other = await applications.resolve('other-app')
    expect(await audits('other')).toEqual([])
    expect(
      await query(`SELECT release_id FROM \`${other.tables.auditLog}\``)
    ).toEqual([{ release_id: second.data.releaseId }])
  })

  it('rolls back a newly created draft and its earlier audit parts then permits a same-key retry', async () => {
    await rejectPartTwo()
    await expect(create(members('new', 401), 'retry-key')).rejects.toThrow(
      'second audit part failed'
    )
    expect(await rows()).toEqual([])
    expect(await audits()).toEqual([
      expect.objectContaining({
        action: 'draft_created',
        result: 'failed',
        change_detail: null,
        error_code: 'DATABASE_WRITE_FAILED'
      })
    ])
    await query('DROP TRIGGER reject_part_two')
    await create(members('new', 401), 'retry-key')
    expect(await rows()).toHaveLength(1)
    expect(
      (await audits()).filter(row => row.result === 'succeeded')
    ).toHaveLength(3)
  })

  it.each(['users', 'key', 'limit'] as const)(
    'audits rejected %s input with a fixed error classification',
    async kind => {
      const input =
        kind === 'users'
          ? ['other:windows:private-secret']
          : kind === 'limit'
            ? members('over', 5001)
            : []
      await expect(
        create(input, kind === 'key' ? 'key-secret'.repeat(30) : undefined)
      ).rejects.toMatchObject({ status: 400 })
      expect(await rows()).toEqual([])
      const records = await audits()
      expect(records).toEqual([
        expect.objectContaining({
          action: 'draft_created',
          result: 'failed',
          error_code: 'INVALID_OPERATION',
          change_detail: null
        })
      ])
      expect(JSON.stringify(records)).not.toMatch(
        /private-secret|key-secret|url-secret|notes-secret/
      )
    }
  )

  it('audits PATCH metadata names and exact before/after membership across all parts', async () => {
    const before = members('before', 201)
    const after = members('after', 201)
    const releaseId = (await create(before)).data.releaseId
    await drafts.updateDraft(
      appName,
      releaseId,
      {
        targetVersionCode: 121,
        userIds: after,
        releaseNotes: 'new-notes-secret',
        installerSourceUrl: 'https://example.test/new?secret=new-url-secret',
        ignoredPassword: 'password-secret'
      } as never,
      context('edit')
    )
    const records = await audits('edit')
    expect(records).toHaveLength(3)
    const summary = records[0].change_summary as {
      changedFields: string[]
      audience: Record<string, unknown>
    }
    expect(summary.changedFields).toEqual([
      'targetVersionCode',
      'userIds',
      'releaseNotes',
      'installerSourceUrl'
    ])
    expect(summary.audience).toMatchObject({
      addedCount: 201,
      removedCount: 201,
      partCount: 3
    })
    expect(
      records.flatMap(
        row => (row.change_detail as { addedUserIds: string[] }).addedUserIds
      )
    ).toEqual(after)
    expect(
      records.flatMap(
        row =>
          (row.change_detail as { removedUserIds: string[] }).removedUserIds
      )
    ).toEqual(before)
    expect(JSON.stringify(records)).not.toMatch(/secret|ignoredPassword/)
    expect((await rows())[0].user_ids).toEqual(after)
    expect(
      await query(`SELECT * FROM \`${application.tables.publishTask}\``)
    ).toEqual([])
  })

  it('records one empty part for a no-op PATCH and preserves the creation timestamp', async () => {
    const releaseId = (await create()).data.releaseId
    const before = (await rows())[0]
    await drafts.updateDraft(appName, releaseId, {}, context('noop'))
    const record = (await audits('noop'))[0]
    expect(record.change_summary).toMatchObject({
      changedFields: [],
      audience: { addedCount: 0, removedCount: 0, partCount: 1 }
    })
    expect(record.change_detail).toEqual({
      addedUserIds: [],
      removedUserIds: []
    })
    expect((await rows())[0].created_at).toEqual(before.created_at)
  })

  it('rolls back PATCH payload, scope and membership when a later audit part fails', async () => {
    const releaseId = (await create(members('before', 201))).data.releaseId
    const before = await rows()
    await rejectPartTwo()
    await expect(
      drafts.updateDraft(
        appName,
        releaseId,
        { userIds: members('after', 201), targetVersionCode: 999 },
        context('failed-edit')
      )
    ).rejects.toThrow('second audit part failed')
    expect(await rows()).toEqual(before)
    expect(await audits('failed-edit')).toEqual([
      expect.objectContaining({
        action: 'draft_updated',
        result: 'failed',
        error_code: 'DATABASE_WRITE_FAILED',
        change_detail: null
      })
    ])
    await query('DROP TRIGGER reject_part_two')
    await drafts.updateDraft(
      appName,
      releaseId,
      { releaseScope: ReleaseScopeType.Public, userIds: [] },
      context('retry-edit')
    )
    expect((await audits('retry-edit'))[0].change_summary).toMatchObject({
      audience: {
        scopeBefore: 'allowlist',
        scopeAfter: 'public',
        removedCount: 201
      }
    })
  })

  it('rejects edits of published, missing and other-application drafts and scopes each failure audit', async () => {
    const releaseId = (await create()).data.releaseId
    await drafts.publish(appName, releaseId, context('publish'))
    await expect(
      drafts.updateDraft(
        appName,
        releaseId,
        { targetVersionCode: 999 },
        context('published')
      )
    ).rejects.toMatchObject({ status: 409 })
    await expect(
      drafts.updateDraft(appName, randomUUID(), {}, context('missing'))
    ).rejects.toMatchObject({ status: 404 })
    await expect(
      drafts.updateDraft('other-app', releaseId, {}, context('wrong-app'))
    ).rejects.toMatchObject({ status: 404 })
    expect((await audits('published'))[0]).toMatchObject({
      result: 'failed',
      error_code: 'OPERATION_CONFLICT'
    })
    expect((await audits('missing'))[0]).toMatchObject({
      result: 'failed',
      error_code: 'RELEASE_NOT_FOUND'
    })
    expect(await audits('wrong-app')).toEqual([])
    const other = await applications.resolve('other-app')
    expect(
      await query(`SELECT result, error_code FROM \`${other.tables.auditLog}\``)
    ).toEqual([{ result: 'failed', error_code: 'RELEASE_NOT_FOUND' }])
    expect(
      ((await rows())[0].payload as { targetVersionCode: number })
        .targetVersionCode
    ).toBe(120)
  })

  it('serializes concurrent PATCH merges without losing metadata or audience updates', async () => {
    const releaseId = (await create(members('before', 1))).data.releaseId
    await Promise.all([
      drafts.updateDraft(
        appName,
        releaseId,
        { userIds: members('after', 201) },
        context('audience-edit')
      ),
      drafts.updateDraft(
        appName,
        releaseId,
        { targetVersionCode: 121 },
        context('metadata-edit')
      )
    ])
    expect((await rows())[0].payload).toMatchObject({
      targetVersionCode: 121,
      userIds: members('after', 201)
    })
    expect((await audits('metadata-edit'))[0].change_summary).toMatchObject({
      changedFields: ['targetVersionCode'],
      audience: { addedCount: 0, removedCount: 0 }
    })
    expect((await audits('audience-edit'))[0].change_summary).toMatchObject({
      changedFields: ['userIds'],
      audience: { addedCount: 201, removedCount: 1 }
    })
  })

  it.each(['scope', 'members'] as const)(
    'rejects disagreeing stored %s without repairing history during an edit',
    async kind => {
      const releaseId = (await create()).data.releaseId
      if (kind === 'scope')
        await query(
          `UPDATE \`${application.tables.releaseDraft}\` SET release_scope = 'allowlist'`
        )
      else
        await query(
          `UPDATE \`${application.tables.releaseDraft}\` SET user_ids = ?`,
          [JSON.stringify(members('historical', 1))]
        )
      const before = await rows()
      await expect(
        drafts.updateDraft(
          appName,
          releaseId,
          { targetVersionCode: 121 },
          context('inconsistent')
        )
      ).rejects.toMatchObject({ status: 409 })
      expect(await rows()).toEqual(before)
      expect(await audits('inconsistent')).toEqual([
        expect.objectContaining({
          result: 'failed',
          error_code: 'OPERATION_CONFLICT',
          change_detail: null
        })
      ])
    }
  )

  it.each(['create', 'edit'] as const)(
    'keeps the original %s error when all audit inserts are unavailable',
    async kind => {
      const releaseId =
        kind === 'edit' ? (await create()).data.releaseId : undefined
      const before = await rows()
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined)
      await query(`CREATE TRIGGER reject_all_audits BEFORE INSERT ON \`${application.tables.auditLog}\`
      FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'audit database secret'`)
      await expect(
        releaseId
          ? drafts.updateDraft(
              appName,
              releaseId,
              { targetVersionCode: 121 },
              context('unavailable')
            )
          : create()
      ).rejects.toThrow('audit database secret')
      expect(await rows()).toEqual(before)
      expect((await audits()).filter(row => row.result === 'failed')).toEqual(
        []
      )
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'application_failure_audit_unavailable'
        })
      )
      expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
    }
  )

  it.each(['create', 'edit'] as const)(
    'revalidates ready state before a stale %s writes any business or success audit data',
    async kind => {
      const releaseId = (await create()).data.releaseId
      const before = await rows()
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined)
      jest.spyOn(applications, 'prepare').mockResolvedValue(application)
      await query(
        "UPDATE ota_applications SET status = 'preparing' WHERE app_name = ?",
        [appName]
      )
      await expect(
        kind === 'create'
          ? create()
          : drafts.updateDraft(
              appName,
              releaseId,
              { targetVersionCode: 999 },
              context('stale-edit')
            )
      ).rejects.toThrow('not ready')
      expect(await rows()).toEqual(before)
      expect(await audits()).toHaveLength(1)
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'application_failure_audit_unavailable'
        })
      )
    }
  )

  it.each(['create', 'edit'] as const)(
    'preserves the successful %s audit after a COMMIT acknowledgement is lost',
    async kind => {
      const releaseId =
        kind === 'edit' ? (await create()).data.releaseId : undefined
      const log = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined)
      const createRunner = source.createQueryRunner.bind(
        source
      ) as DataSource['createQueryRunner']
      let wroteDraft = false
      let injected = false
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
          if (
            sql.startsWith(
              `${kind === 'create' ? 'INSERT INTO' : 'UPDATE'} \`${application.tables.releaseDraft}\``
            )
          )
            wroteDraft = true
          if (wroteDraft && !injected && sql === 'COMMIT') {
            injected = true
            throw new Error('lost commit acknowledgement secret')
          }
          return result
        }) as QueryRunner['query']
        return runner
      })
      await expect(
        releaseId
          ? drafts.updateDraft(
              appName,
              releaseId,
              { targetVersionCode: 121 },
              context('lost-edit')
            )
          : create([], 'lost-create-key')
      ).rejects.toThrow('lost commit acknowledgement')
      expect(injected).toBe(true)
      expect(await rows()).toHaveLength(1)
      expect((await audits()).every(row => row.result === 'succeeded')).toBe(
        true
      )
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'application_operation_outcome_requires_review',
          outcome: 'unknown'
        })
      )
      if (!releaseId) {
        await create([], 'lost-create-key')
        expect(await audits()).toHaveLength(1)
      }
    }
  )
})
