import { Server } from 'http'
import { Global, INestApplication, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Test } from '@nestjs/testing'
import { DataSource, EntityManager, QueryRunner, Table } from 'typeorm'
import request from 'supertest'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { ExceptionFilter } from '@/middleware/exception-filter'
import { AdministrationModule } from '@/admin/administration.module'

const sql: Array<{ query: string; parameters: unknown[] }> = []
const sqlSource = new DataSource({ type: 'mysql', database: 'test' })
const repository = {
  findOne: jest.fn(({ where }: { where: { id?: number; username?: string } }) =>
    Promise.resolve(
      where.id === 1 || where.username === 'admin'
        ? { id: 1, username: 'admin' }
        : null
    )
  )
}
const table = (name: string) =>
  new Table({
    name,
    columns: [
      'id',
      'name',
      'platform',
      'ver',
      'ver_id',
      'release_sequence',
      'created_at',
      'create_time',
      'updated_at',
      'update_time'
    ].map(column => ({ name: column, type: 'varchar' }))
  })

function resultRows(query: string) {
  if (/COUNT\(\*\)/.test(query))
    return [{ total: query.includes('app_a_success') ? 5 : 2 }]
  if (query.includes('app_a_success') || query.includes('app_a_error`')) {
    return [
      {
        id: 7,
        name: 'app-a',
        platform: 'windows',
        ver: 110,
        ver_id: 2000,
        reported_username: 'tester',
        created_at: '2026-10-01T00:00:00.000Z',
        extras_json: '{"business_key":"unchanged"}',
        unexpected_secret: 'must-not-be-returned'
      }
    ]
  }
  if (query.includes('error_log'))
    return [
      {
        id: 8,
        name: 'app-a',
        kind: 'crash',
        report_count: 17,
        updated_at: '2026-10-01T00:00:00.000Z',
        extras_json: '{}'
      }
    ]
  if (query.includes('app_b_publish_task')) return []
  if (query.includes('publish_task_log'))
    return [
      {
        task_id: 'task-a',
        attempt_no: 2,
        status: 'lease_expired',
        metrics_complete: 0
      }
    ]
  if (query.includes('publish_task'))
    return [{ task_id: 'task-a', status: 'failed' }]
  if (query.includes('_version')) return [{ releaseId: 'release-a' }]
  return [{ audit_id: 'audit-a', result: 'failed' }]
}

function createQueryRunner() {
  const runner = {
    connect: jest.fn(),
    release: jest.fn(),
    getTable: jest.fn((name: string) => Promise.resolve(table(name))),
    query: jest.fn((query: string, parameters: unknown[] = []) => {
      sql.push({ query, parameters })
      const rows = resultRows(query)
      return Promise.resolve({
        records: rows,
        raw: rows,
        affected: rows.length
      })
    }),
    manager: undefined as unknown as EntityManager,
    isTransactionActive: false
  }
  runner.manager = new EntityManager(
    sqlSource,
    runner as unknown as QueryRunner
  )
  return runner
}

@Global()
@Module({
  providers: [
    {
      provide: DataSource,
      useValue: {
        options: { type: 'mysql' },
        entityMetadatas: [],
        getRepository: () => repository,
        createQueryRunner
      }
    }
  ],
  exports: [DataSource]
})
class TestDatabaseModule {}

describe('external administrator HTTP APIs', () => {
  let app: INestApplication<Server>
  let token: string
  let jwt: JwtService
  const range = { from: '2026-10-01T00:00:00Z', to: '2026-10-20T00:00:00Z' }
  const tables = new ApplicationTableResolver()

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        TestDatabaseModule,
        AdministrationModule
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === 'JWT_SECRET' ? 'administration-test-only-secret' : undefined
      })
      .overrideProvider(ApplicationRegistryService)
      .useValue({
        resolve: (appName: string) => {
          const prefix = appName === 'app-a' ? 'app_a' : 'app_b'
          return Promise.resolve({
            appName,
            tablePrefix: prefix,
            schemaVersion: 1,
            status: ['app-a', 'app-b'].includes(appName)
              ? 'ready'
              : 'preparing',
            tables: tables.resolve(appName, prefix)
          })
        }
      })
      .compile()
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false
    })
    app.setGlobalPrefix('api')
    app.useGlobalFilters(new ExceptionFilter())
    await app.listen(0, '127.0.0.1')
    jwt = module.get(JwtService)
    token = await jwt.signAsync({ sub: 1 })
  })

  beforeEach(() => {
    sql.length = 0
  })
  afterAll(async () => {
    if (app) await app.close()
  })

  it.each([
    '/v2/apps/app-a/statistics/summary',
    '/v2/apps/app-a/telemetry/successes',
    '/v2/apps/app-a/telemetry/failures',
    '/v2/apps/app-a/telemetry/app-errors',
    '/v2/apps/app-a/tasks',
    '/v2/apps/app-a/tasks/task-a',
    '/v2/apps/app-a/tasks/task-a/logs',
    '/v2/apps/app-a/releases/release-a/delivery',
    '/v2/apps/app-a/audit-logs',
    '/v2/admin/audit-logs'
  ])(
    'requires authentication independently of legacy modules: %s',
    async path => {
      await request(app.getHttpServer()).get(`/api${path}`).expect(401)
      expect(sql).toHaveLength(0)
    }
  )

  it('rejects tampered, expired, unknown administrator and identity-less tokens', async () => {
    const tokens = [
      `${token}bad`,
      await jwt.signAsync({ sub: 1 }, { expiresIn: -1 }),
      await jwt.signAsync({ sub: 999 }),
      await jwt.signAsync({})
    ]
    for (const bearer of tokens) {
      await request(app.getHttpServer())
        .get('/api/v2/admin/audit-logs')
        .set('Authorization', `Bearer ${bearer}`)
        .expect(401)
    }
    expect(sql).toHaveLength(0)
  })

  it('accepts old username-only administrator tokens and parameterizes audit filters', async () => {
    const oldToken = await jwt.signAsync({ username: 'admin' })
    const action = "publish' OR 1=1 --"
    await request(app.getHttpServer())
      .get('/api/v2/admin/audit-logs')
      .set('Authorization', `Bearer ${oldToken}`)
      .query({ ...range, action, result: 'failed', actorAdminId: '1' })
      .expect(200)
    expect(sql.some(call => call.parameters.includes(action))).toBe(true)
    expect(sql.every(call => !call.query.includes(action))).toBe(true)
  })

  it('returns report counts filtered by application, platform, release and time', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v2/apps/app-a/statistics/summary')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...range, platform: 'windows', releaseSequence: '2000' })
      .expect(200)
    expect(response.body).toMatchObject({
      code: 0,
      data: {
        successCount: 5,
        errorCount: 2,
        countSemantics: 'report-records',
        receiveConfirmationAvailable: false
      }
    })
    expect(sql).toHaveLength(2)
    for (const call of sql) {
      expect(call.parameters).toEqual(
        expect.arrayContaining(['app-a', 'windows', 2000])
      )
      expect(call.query).toContain('COALESCE(')
    }
  })

  it('returns allowlisted report fields and preserves arbitrary extras keys', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v2/apps/app-a/telemetry/successes')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...range, page: '2', pageSize: '2' })
      .expect(200)
    expect(response.body).toMatchObject({
      code: 0,
      data: {
        total: 5,
        page: 2,
        pageSize: 2,
        data: [
          {
            id: 7,
            releaseSequence: 2000,
            extras: { business_key: 'unchanged' }
          }
        ]
      }
    })
    expect(JSON.stringify(response.body)).not.toContain('unexpected_secret')
    expect(sql.some(call => /LIMIT 2 OFFSET 2/.test(call.query))).toBe(true)
  })

  it('labels aggregated client-error lifetime counts and filters last occurrence', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v2/apps/app-a/telemetry/app-errors')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...range, kind: 'crash' })
      .expect(200)
    expect(response.body).toMatchObject({
      data: {
        windowBasis: 'lastSeenAt',
        reportCountSemantics:
          'lifetime-count-for-each-group-not-count-within-query-window',
        data: [{ reportCount: 17 }]
      }
    })
    expect(sql[0].query).toContain('updated_at')
  })

  it('routes application audit logs to the registered application table', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/apps/app-b/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...range, taskId: 'task-a', requestId: 'req-1' })
      .expect(200)
    expect(sql.every(call => call.query.includes('app_b_audit_log'))).toBe(true)
    expect(sql[0].parameters).toEqual(
      expect.arrayContaining(['task-a', 'req-1'])
    )
  })

  it('preserves incomplete task execution metrics and task status filters', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v2/apps/app-a/tasks/task-a/logs')
      .set('Authorization', `Bearer ${token}`)
      .query({ ...range, status: 'lease_expired' })
      .expect(200)
    expect(response.body).toMatchObject({
      data: { data: [{ metrics_complete: 0, attempt_no: 2 }] }
    })
    expect(sql.some(call => call.parameters.includes('lease_expired'))).toBe(
      true
    )
  })

  it('does not find another application task by its ID', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/apps/app-b/tasks/task-a')
      .set('Authorization', `Bearer ${token}`)
      .expect(404)
    expect(sql.every(call => !call.query.includes('app_a_'))).toBe(true)
  })

  it('paginates delivery tasks and includes their latest execution without recipient claims', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v2/apps/app-a/releases/release-a/delivery')
      .set('Authorization', `Bearer ${token}`)
      .query(range)
      .expect(200)
    expect(response.body).toMatchObject({
      data: {
        receiveConfirmationAvailable: false,
        countSemantics: 'application-dispatch-attempts-not-release-recipients',
        tasks: [{ task_id: 'task-a', latestLog: { metrics_complete: 0 } }]
      }
    })
  })

  it.each([
    { page: '0' },
    { pageSize: '101' },
    { platform: 'invalid' },
    { releaseSequence: '1 OR 1=1' },
    { from: '2026-10-01' },
    { from: '2026-01-01T00:00:00Z', to: '2026-10-20T00:00:00Z' },
    { secretColumn: 'password' },
    { page: ['1', '2'] }
  ])(
    'rejects invalid or unbounded query before database reads %j',
    async query => {
      await request(app.getHttpServer())
        .get('/api/v2/apps/app-a/telemetry/failures')
        .set('Authorization', `Bearer ${token}`)
        .query(query)
        .expect(400)
      expect(sql).toHaveLength(0)
    }
  )

  it('refuses unprepared applications without running schema mutations', async () => {
    await request(app.getHttpServer())
      .get('/api/v2/apps/unknown/statistics/summary')
      .set('Authorization', `Bearer ${token}`)
      .expect(409)
    expect(sql).toHaveLength(0)
  })
})
