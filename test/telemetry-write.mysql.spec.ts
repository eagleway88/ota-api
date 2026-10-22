import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { Test } from '@nestjs/testing'
import { Server } from 'http'
import request from 'supertest'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { AdminReadRepository } from '@/infrastructure/persistence/admin-read.repository'
import { withApplicationWrite } from '@/infrastructure/persistence/application-write-transaction'
import { DualWriteReleaseRepository } from '@/infrastructure/persistence/legacy/dual-write-release.repository'
import { DualWriteTelemetryRepository } from '@/infrastructure/persistence/legacy/dual-write-telemetry.repository'
import { LegacyUpdateCheckController } from '@/compat/legacy/update-check.controller'
import { LegacyUpdateCheckService } from '@/compat/legacy/update-check.service'
import { UpdateQueryService } from '@/updates/update-query.service'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { TelemetryWriteController } from '@/app/telemetry/telemetry.controller'
import { RefactoringFoundation1792444800000 } from '@/migrations/1792444800000-RefactoringFoundation'
import { ApplicationDataMigration1792445100000 } from '@/migrations/1792445100000-ApplicationDataMigration'
import { configureHttp } from '@/config/http'
import { TelemetryWriteService } from '@/telemetry/telemetry-write.service'
import { TelemetryQueryService } from '@/manage/statistics/statistics.service'
import { StatusReportInput } from '@/telemetry/ports/telemetry-write.repository'

const socketPath = process.env.OTA_MIGRATION_TEST_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('telemetry writes on isolated MySQL', () => {
  let control: DataSource
  let source: DataSource
  let database: string
  let applications: ApplicationRegistryService
  let app: RegisteredApplication
  let writes: TelemetryWriteService
  const appName = 'telemetry-app'
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
  const report = (
    overrides: Partial<StatusReportInput> = {}
  ): StatusReportInput => ({
    appName,
    platform: 'windows',
    versionCode: 110,
    releaseSequence: 2000,
    reportedUsername: 'reporter',
    extras: { device_id: 'one', innerCamel: { nested_key: 1 } },
    ...overrides
  })
  const rows = (kind: 'success' | 'error' | 'errorLog') =>
    query(`SELECT * FROM \`${app.tables[kind]}\` ORDER BY id`)
  const publish = (application = app) =>
    withApplicationWrite(source, application, runner =>
      new DualWriteReleaseRepository().insert(runner, application, {
        appName: application.appName,
        releaseId: randomUUID(),
        targetVersionCode: 110,
        compatibleBaseVersionCodes: [100],
        platforms: ['windows'],
        architectures: [],
        updateType: 'full',
        releaseScope: 'public',
        enabled: true,
        mandatory: false,
        showUpdateDialog: true,
        installerSourceUrl: 'https://example.test/installer.exe',
        createdAt: new Date()
      })
    )

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
    await query(
      "INSERT INTO ota_applications (app_name, table_prefix, status, schema_version, catalog_revision, created_at, updated_at) VALUES (?, 'telemetry_123a', 'preparing', 0, 0, NOW(), NOW())",
      [appName]
    )
    app = await applications.prepare(appName)
    await publish()
    writes = new TelemetryWriteService(
      new DualWriteTelemetryRepository(source, applications)
    )
  })
  afterEach(async () => {
    if (source?.isInitialized) await source.destroy()
    if (/^ota_migration_test_[a-f0-9]{32}$/.test(database))
      await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  it('keeps the old check contract while serving formal v2 reports and rejecting retired version routes', async () => {
    const module = await Test.createTestingModule({
      controllers: [LegacyUpdateCheckController, TelemetryWriteController],
      providers: [
        LegacyUpdateCheckService,
        {
          provide: UpdateQueryService,
          useValue: new UpdateQueryService(
            new ReleaseCatalogService(source, applications)
          )
        },
        { provide: TelemetryWriteService, useValue: writes }
      ]
    }).compile()
    const http = module.createNestApplication<
      import('@nestjs/common').INestApplication<Server>
    >({ logger: false })
    configureHttp(http)
    await http.listen(0, '127.0.0.1')
    try {
      for (const ver of [100, '1.0.0']) {
        const check = await request(http.getHttpServer())
          .post('/api/version/check')
          .send({ name: appName, platform: 'windows', ver, id: 0 })
          .expect(201)
        expect(check.body).toMatchObject({
          code: 0,
          data: {
            id: 2000,
            ver: 110,
            name: appName,
            enable: 1,
            type: 1,
            downloadUrl: 'https://example.test/installer.exe',
            installUrl: 'https://example.test/installer.exe',
            mandatory: 0,
            isMandatory: 0,
            showDialog: 1
          }
        })
        expect((check.body as { data: unknown }).data).not.toHaveProperty(
          'releaseSequence'
        )
      }
      const noUpdate = await request(http.getHttpServer())
        .post('/api/version/check')
        .send({ name: appName, platform: 'windows', ver: 110, id: 2000 })
        .expect(201)
      expect(noUpdate.body).toEqual({ code: 0, data: null })
      for (const path of [
        'create',
        'upload',
        'list/app',
        'success',
        'error',
        'app-error'
      ]) {
        await request(http.getHttpServer())
          .post('/api/version/' + path)
          .send({})
          .expect(404)
      }
      const base = '/api/v1/app/apps/' + appName + '/telemetry/'
      const body = {
        platform: 'windows',
        versionCode: 110,
        releaseSequence: 2000,
        reportedUsername: 'reporter',
        extras: { device_id: 'one', innerCamel: { nested_key: 1 } }
      }
      await request(http.getHttpServer())
        .post(base + 'successes')
        .send({ ...body, appName: 'forged-app', sourceIp: 'forged-ip' })
        .expect(400)
      const success = await request(http.getHttpServer())
        .post(base + 'successes')
        .send(body)
        .expect(201)
      expect(success.body).toMatchObject({
        code: 0,
        data: {
          id: 1,
          appName,
          versionCode: 110,
          releaseSequence: 2000,
          reportedUsername: 'reporter',
          extras: body.extras
        }
      })
      expect((success.body as { data: unknown }).data).not.toHaveProperty(
        'verId'
      )
      for (const extras of [
        '123',
        '{"device_id":"text-not-an-object"}',
        null
      ]) {
        const scalar = await request(http.getHttpServer())
          .post(base + 'app-errors')
          .send({
            platform: 'windows',
            versionCode: 110,
            kind: 'scalar-test',
            message: 'type preservation',
            extras
          })
          .expect(201)
        expect(
          (scalar.body as { data: { extras: unknown } }).data.extras
        ).toEqual(extras)
      }
      const error = await request(http.getHttpServer())
        .post(base + 'failures')
        .send({ ...body, message: 'first' })
        .expect(201)
      const updated = await request(http.getHttpServer())
        .post(base + 'failures')
        .send({
          ...body,
          recordId: (error.body as { data: { id: number } }).data.id,
          message: 'updated'
        })
        .expect(201)
      expect((updated.body as { data: unknown }).data).toMatchObject({
        id: 1,
        message: 'updated',
        releaseSequence: 2000
      })
      const crash = await request(http.getHttpServer())
        .post(base + 'app-errors')
        .send({
          platform: 'windows',
          versionCode: 110,
          kind: 'crash',
          message: 'crash'
        })
        .expect(201)
      expect((crash.body as { data: unknown }).data).toMatchObject({
        reportCount: 1,
        kind: 'crash'
      })
      await request(http.getHttpServer())
        .post(base + 'successes')
        .send({ ...body, releaseSequence: 9999 })
        .expect(400)
      await request(http.getHttpServer())
        .post(base + 'successes')
        .send({ ...body, versionCode: '110' })
        .expect(400)
      const summary = await new TelemetryQueryService(
        new AdminReadRepository(source, applications)
      ).summary(appName, {
        from: new Date(Date.now() - 60_000).toISOString(),
        to: new Date(Date.now() + 60_000).toISOString()
      })
      expect(summary.data).toMatchObject({ successCount: 1, errorCount: 1 })
      expect((await rows('success'))[0]).toMatchObject({
        name: appName,
        release_sequence: 2000,
        extras: report().extras
      })
      expect(app.tablePrefix).toBe('telemetry_123a')
    } finally {
      await http.close()
    }
  })

  it('counts unkeyed events individually and deduplicates concurrent identical keyed retries', async () => {
    await Promise.all(Array.from({ length: 8 }, () => writes.success(report())))
    const reportId = randomUUID()
    const retried = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        writes.success(
          report({
            reportId: index % 2 ? reportId.toUpperCase() : reportId,
            sourceIp: String(index)
          })
        )
      )
    )
    expect(new Set(retried.map(row => row.id)).size).toBe(1)
    expect(await rows('success')).toHaveLength(9)
    const differentKeys = await Promise.all(
      Array.from({ length: 8 }, () =>
        writes.success(report({ reportId: randomUUID() }))
      )
    )
    expect(new Set(differentKeys.map(row => row.id)).size).toBe(8)
  })

  it.each([
    { releaseSequence: 2001 },
    { platform: 'linux' },
    { versionCode: 120 },
    { reportedUsername: 'different' },
    { extras: { changed: true } }
  ] as Array<Partial<StatusReportInput>>)(
    'rejects reportId reuse with different context/content: %j',
    async changed => {
      await publish()
      const reportId = randomUUID()
      const first = await writes.success(report({ reportId }))
      await expect(
        writes.success(report({ reportId, ...changed }))
      ).rejects.toThrow(/another release|different content/)
      expect(await writes.success(report({ reportId }))).toEqual(first)
      expect(await rows('success')).toHaveLength(1)
    }
  )

  it('updates legacy failure details in place, preserves history, and refuses release reassignment', async () => {
    await publish()
    await query(
      `INSERT INTO \`${app.tables.error}\` (id, name, platform, ver, ver_id, message, username, create_time) VALUES (41, ?, 'windows', 110, 2000, 'old', 'old-user', '2020-01-01 00:00:00')`,
      [appName]
    )
    const updated = await writes.failure({
      ...report(),
      recordId: 41,
      message: 'new details'
    })
    expect(updated).toMatchObject({
      id: 41,
      releaseSequence: 2000,
      message: 'new details',
      createdAt: '2020-01-01 00:00:00'
    })
    const [stored] = await rows('error')
    expect(stored).toMatchObject({
      ver_id: 2000,
      release_sequence: 2000,
      username: 'reporter',
      reported_username: 'reporter'
    })
    expect(stored.update_time).toBe(stored.updated_at)
    await expect(
      writes.failure({
        ...report({ releaseSequence: 2001 }),
        recordId: 41,
        message: 'move'
      })
    ).rejects.toThrow('another release')
    await expect(
      writes.failure({ ...report(), recordId: 42, message: 'missing' })
    ).rejects.toThrow('does not exist')
    expect(await rows('error')).toHaveLength(1)
  })

  it('keeps keyed failures immutable while allowing exact replays and independent success/failure keys', async () => {
    const input = { ...report({ reportId: randomUUID() }), message: 'initial' }
    const first = await writes.failure(input)
    await expect(
      writes.failure({ ...input, message: 'changed' })
    ).rejects.toThrow('different content')
    await expect(
      writes.failure({
        ...input,
        recordId: first.id,
        reportId: undefined,
        message: 'changed'
      })
    ).rejects.toThrow('immutable')
    expect(await writes.failure({ ...input, recordId: first.id })).toEqual(
      first
    )
    expect(await writes.failure(input)).toEqual(first)
    await writes.success(input)
    expect(await rows('error')).toHaveLength(1)
    expect(await rows('success')).toHaveLength(1)
  })

  it('routes equal release/report IDs to separate applications and validates release ownership', async () => {
    const other = await applications.prepare('other-app')
    await publish(other)
    const reportId = randomUUID()
    const [a, b] = await Promise.all([
      writes.success(report({ reportId })),
      writes.success(report({ appName: other.appName, reportId }))
    ])
    expect(a.id).toBe(b.id)
    expect(a.appName).not.toBe(b.appName)
    await query(
      `UPDATE \`${app.tables.version}\` SET name = 'other-app' WHERE id = 2000`
    )
    await expect(writes.success(report())).rejects.toThrow(
      'Version does not exist'
    )
    expect(await rows('success')).toHaveLength(1)
  })

  it('aggregates concurrent errors exactly and rolls back detail/count updates together', async () => {
    const input = {
      ...report(),
      kind: 'crash',
      message: 'error\r\nline ',
      stack: ' stack '
    }
    const emitted = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        writes.applicationError({ ...input, reportedUsername: String(index) })
      )
    )
    expect(new Set(emitted.map(row => row.id)).size).toBe(1)
    expect((await rows('errorLog'))[0].report_count).toBe(12)
    const next = await writes.applicationError({
      ...input,
      message: 'error\nline',
      stack: 'stack',
      reportedUsername: 'latest'
    })
    expect(next.reportCount).toBe(13)
    const before = await rows('errorLog')
    await query(
      `CREATE TRIGGER fail_error_update BEFORE UPDATE ON \`${app.tables.errorLog}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected update failure'`
    )
    await expect(
      writes.applicationError({
        ...input,
        reportedUsername: 'must-not-persist'
      })
    ).rejects.toThrow('injected update failure')
    expect(await rows('errorLog')).toEqual(before)
    await query('DROP TRIGGER fail_error_update')
    expect((await writes.applicationError(input)).reportCount).toBe(14)
  })

  it('does not merge different tuples sharing the old delimiter-based fingerprint', async () => {
    const input = { ...report(), kind: 'crash', message: 'a|b', stack: 'c' }
    await writes.applicationError(input)
    await expect(
      writes.applicationError({ ...input, message: 'a', stack: 'b|c' })
    ).rejects.toThrow('fingerprint conflicts')
    expect((await rows('errorLog'))[0].report_count).toBe(1)
  })

  it('does not ignore insert failures and releases the retry lock after rollback', async () => {
    const input = report({ reportId: randomUUID() })
    await query(
      `CREATE TRIGGER fail_report_insert AFTER INSERT ON \`${app.tables.success}\` FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'injected report failure'`
    )
    await expect(writes.success(input)).rejects.toThrow(
      'injected report failure'
    )
    expect(await rows('success')).toHaveLength(0)
    await query('DROP TRIGGER fail_report_insert')
    await writes.success(input)
    expect(await rows('success')).toHaveLength(1)
  })

  it('rejects incomplete/unprepared schemas without executing repair DDL or creating orphan reports', async () => {
    await query(
      `ALTER TABLE \`${app.tables.success}\` DROP COLUMN reported_username`
    )
    await expect(writes.success(report())).rejects.toThrow(
      'schema is incomplete'
    )
    const runner = source.createQueryRunner()
    try {
      const table = await runner.getTable(app.tables.success)
      expect(table?.findColumnByName('reported_username')).toBeUndefined()
    } finally {
      await runner.release()
    }
    expect(await rows('success')).toHaveLength(0)
    await expect(
      writes.success(report({ appName: 'unknown' }))
    ).rejects.toThrow('schema is not ready')
    expect(await query("SHOW TABLES LIKE 'unknown_success'")).toHaveLength(0)
  })

  it.each(['123', 'null', 'true', '{"nested":1}'])(
    'preserves JSON scalar strings through persistence and retry comparison: %s',
    extras => {
      const input = report({ reportId: randomUUID(), extras })
      return writes.success(input).then(async first => {
        expect(first.extras).toBe(extras)
        expect(await writes.success(input)).toEqual(first)
        const read = new TelemetryQueryService(
          new AdminReadRepository(source, applications)
        )
        const window = {
          from: new Date(Date.now() - 60_000).toISOString(),
          to: new Date(Date.now() + 60_000).toISOString()
        }
        expect(
          (await read.reports(appName, 'success', window)).data.data[0].extras
        ).toBe(extras)
        await writes.applicationError({
          ...input,
          kind: 'error',
          message: 'json scalar'
        })
        expect(
          (await read.appErrors(appName, window)).data.data[0].extras
        ).toBe(extras)
      })
    }
  )
})
