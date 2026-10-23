import { InitialSchema1792713600000 } from '@/migrations/1792713600000-InitialSchema'
import 'reflect-metadata'
import { randomUUID } from 'crypto'
import { Controller, Get, INestApplication, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { Server } from 'http'
import request from 'supertest'
import { AuthModule } from '@/auth/auth.module'
import { ApiKeyManagementService } from '@/auth/api-key-management.service'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { ReleaseManagementController } from '@/manage/releases/releases.controller'
import { ArtifactsController } from '@/manage/artifacts/artifacts.controller'
import { TelemetryController } from '@/manage/statistics/statistics.controller'
import { TaskQueryController } from '@/manage/tasks/tasks.controller'
import { AuditController } from '@/manage/audit/audit.controller'
import { MessageController } from '@/manage/messages/messages.controller'
import { ReleaseManagementService } from '@/releases/release-management.service'
import { ReleaseDraftService } from '@/releases/release-draft.service'
import { ArtifactService } from '@/infrastructure/oss/artifact.service'
import { TelemetryQueryService } from '@/manage/statistics/statistics.service'
import { TaskQueryService } from '@/manage/tasks/tasks.service'
import { AuditQueryService } from '@/manage/audit/audit.service'
import { MessageService } from '@/manage/messages/messages.service'
import { LastMessageService } from '@/messaging/last-message.service'
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import { ApplicationMessage } from '@/entities/application-message.entity'
import { UpdateCheckController } from '@/app/updates/update-check.controller'
import { UpdateCheckService } from '@/app/updates/update-check.service'
import { configureHttp } from '@/config/http'
import type { ApiKeyPreset } from '@/auth/api-key.policy'

@Module({})
class PersistenceFixture {}
@Controller('manage/apps/:appName/unconfigured')
class UnconfiguredController {
  @Get() read() {
    return 'must not run'
  }
}
const socketPath = process.env.OTA_TEST_MYSQL_SOCKET
const mysql = socketPath ? describe : describe.skip
mysql('scoped API key authorization through real HTTP and MySQL', () => {
  let control: DataSource,
    source: DataSource,
    database: string,
    http: INestApplication<Server>
  let keys: ApiKeyManagementService, messages: LastMessageService
  let tokens: Record<ApiKeyPreset, { keyId: string; accessKey: string }>
  const context = {
    requestId: 'cli-http-test',
    actorType: 'operator' as const,
    actorName: 'test'
  }
  const connection = {
    type: 'mysql' as const,
    username: 'root',
    extra: { socketPath },
    synchronize: false,
    logging: false
  }
  const ok = () => ({ code: 0, data: [] })
  const releases = { setEnabled: jest.fn(ok) },
    drafts = { list: jest.fn(ok), createDraft: jest.fn(ok) }
  const artifacts = { uploadArtifact: jest.fn(ok) },
    statistics = {
      summary: jest.fn(ok),
      reports: jest.fn(ok),
      appErrors: jest.fn(ok)
    }
  const tasks = {
    list: jest.fn(ok),
    detail: jest.fn(ok),
    logs: jest.fn(ok),
    delivery: jest.fn(ok)
  }
  const audit = { listApplication: jest.fn(ok) }
  const gateway = {
    sendApplicationMessage: jest.fn().mockResolvedValue(true),
    sendUserIdMessage: jest.fn().mockResolvedValue(true),
    sendUniqueIdMessage: jest.fn().mockResolvedValue(true),
    getSubscribedUserIds: jest.fn().mockResolvedValue([])
  }
  const get = (path: string, preset: ApiKeyPreset = 'full') =>
    request(http.getHttpServer())
      .get('/api/v1/manage/apps/' + path)
      .set('Authorization', 'Bearer ' + tokens[preset].accessKey)
  const post = (path: string, body = {}, preset: ApiKeyPreset = 'full') =>
    request(http.getHttpServer())
      .post('/api/v1/manage/apps/' + path)
      .set('Authorization', 'Bearer ' + tokens[preset].accessKey)
      .send(body)
  beforeAll(async () => {
    if (
      !/^\/(?:private\/)?tmp\/ota-test-mysql\.[A-Za-z0-9]+\/mysql\.sock$/.test(
        socketPath ?? ''
      )
    )
      throw new Error('Use only an isolated temporary MySQL socket')
    control = new DataSource(connection)
    await control.initialize()
  })
  beforeEach(async () => {
    jest.clearAllMocks()
    database = 'ota_test_' + randomUUID().replaceAll('-', '')
    await control.query(`CREATE DATABASE \`${database}\``)
    source = new DataSource({
      ...connection,
      database,
      entities: [ApplicationMessage]
    })
    await source.initialize()
    const runner = source.createQueryRunner()
    try {
      await new InitialSchema1792713600000().up(runner)
    } finally {
      await runner.release()
    }
    const applications = new ApplicationRegistryService(
      source,
      new ApplicationTableResolver()
    )
    for (const app of ['app-a', 'app-b', 'app-c'])
      await applications.prepare(app)
    keys = new ApiKeyManagementService(source)
    tokens = {} as typeof tokens
    for (const preset of [
      'publisher',
      'observer',
      'messenger',
      'full'
    ] as const) {
      tokens[preset] = await keys.create(
        {
          name: preset,
          preset,
          applications: ['app-a', 'app-b'],
          expiresAt: null
        },
        context
      )
    }
    messages = new LastMessageService(source.getRepository(ApplicationMessage))
    const config = new ConfigService({})
    const module = await Test.createTestingModule({
      imports: [
        {
          module: PersistenceFixture,
          global: true,
          providers: [{ provide: DataSource, useValue: source }],
          exports: [DataSource]
        },
        AuthModule
      ],
      controllers: [
        ReleaseManagementController,
        ArtifactsController,
        TelemetryController,
        TaskQueryController,
        AuditController,
        MessageController,
        UpdateCheckController,
        UnconfiguredController
      ],
      providers: [
        { provide: ReleaseManagementService, useValue: releases },
        { provide: ReleaseDraftService, useValue: drafts },
        { provide: ArtifactService, useValue: artifacts },
        { provide: TelemetryQueryService, useValue: statistics },
        { provide: TaskQueryService, useValue: tasks },
        { provide: AuditQueryService, useValue: audit },
        {
          provide: MessageService,
          useValue: new MessageService(
            gateway as unknown as RealtimeGateway,
            config,
            messages
          )
        },
        {
          provide: UpdateCheckService,
          useValue: { check: () => null }
        }
      ]
    }).compile()
    http = module.createNestApplication<INestApplication<Server>>({
      logger: false
    })
    configureHttp(http)
    await http.listen(0, '127.0.0.1')
  })
  afterEach(async () => {
    if (http) await http.close()
    if (source?.isInitialized) await source.destroy()
    if (database) await control.query(`DROP DATABASE \`${database}\``)
  })
  afterAll(async () => {
    if (control?.isInitialized) await control.destroy()
  })

  const routes = [
    ['get', 'releases'],
    ['post', 'releases/release-a/disable'],
    ['get', 'statistics/summary'],
    ['get', 'tasks/task-a/logs'],
    ['get', 'audit-logs'],
    ['get', 'messages/user-id-subscriptions'],
    ['post', 'messages/application']
  ] as const
  it.each(['publisher', 'observer', 'messenger', 'full'] as const)(
    'enforces the complete %s preset, including full',
    async preset => {
      const allowed = {
        publisher: [0, 1, 3],
        observer: [0, 2, 3, 4],
        messenger: [5, 6],
        full: [0, 1, 2, 3, 4, 5, 6]
      }[preset]
      for (const [index, [method, path]] of routes.entries()) {
        const expected = allowed.includes(index)
          ? method === 'get'
            ? 200
            : 201
          : 403
        await (
          method === 'get'
            ? get('app-a/' + path, preset)
            : post('app-a/' + path, {}, preset)
        ).expect(expected)
      }
    }
  )
  it('allows one full key to operate on both named applications, never a third, prefix or case variant', async () => {
    for (const app of ['app-a', 'app-b'])
      await get(app + '/statistics/summary').expect(200)
    for (const app of ['app-c', 'app-a-dev', 'APP-A'])
      await get(app + '/statistics/summary').expect(403)
    expect(statistics.summary).toHaveBeenCalledTimes(2)
  })
  it('keeps credential and application provisioning in the operational CLI', async () => {
    for (const path of [
      '/api/v1/manage/api-keys',
      '/api/v1/manage/api-keys/' + tokens.full.keyId + '/grant',
      '/api/v1/manage/api-keys/' + tokens.full.keyId + '/ungrant',
      '/api/v1/manage/applications',
      '/api/v1/manage/apps/app-a/prepare'
    ]) {
      await request(http.getHttpServer())
        .post(path)
        .set('Authorization', 'Bearer ' + tokens.full.accessKey)
        .send({})
        .expect(404)
    }
    await request(http.getHttpServer())
      .get('/api/v1/manage/audit-logs')
      .set('Authorization', 'Bearer ' + tokens.full.accessKey)
      .expect(404)
  })
  it('applies scope changes to the next request with the same key and no restart', async () => {
    await get('app-c/statistics/summary').expect(403)
    await keys.grantApplications(tokens.full.keyId, ['app-c'], context)
    await get('app-c/statistics/summary').expect(200)
    await keys.ungrantApplications(tokens.full.keyId, ['app-b'], context)
    await get('app-b/statistics/summary').expect(403)
    await get('app-a/statistics/summary').expect(200)
    await get('app-c/statistics/summary').expect(200)
  })
  it('does not broaden preset permissions when granting another application', async () => {
    await keys.grantApplications(tokens.observer.keyId, ['app-c'], context)
    await get('app-c/statistics/summary', 'observer').expect(200)
    await post('app-c/releases/release-a/disable', {}, 'observer').expect(403)
    expect(releases.setEnabled).not.toHaveBeenCalled()
  })
  it('denies every scoped request after all grants are removed and supports regranting', async () => {
    await keys.ungrantApplications(
      tokens.full.keyId,
      ['app-a', 'app-b'],
      context
    )
    for (const app of ['app-a', 'app-b', 'app-c'])
      await get(app + '/statistics/summary').expect(403)
    await keys.grantApplications(tokens.full.keyId, ['app-a'], context)
    await get('app-a/statistics/summary').expect(200)
    await get('app-b/statistics/summary').expect(403)
  })
  it('fails closed for endpoints with no explicit permission policy', async () => {
    await get('app-a/unconfigured').expect(403)
  })
  it('rejects missing, malformed and wrong-secret credentials before business access', async () => {
    for (const value of [
      '',
      'Bearer invalid-credential',
      'Bearer ' + tokens.full.accessKey + 'bad'
    ]) {
      await request(http.getHttpServer())
        .get('/api/v1/manage/apps/app-a/releases')
        .set('Authorization', value)
        .expect(401)
    }
    expect(drafts.list).not.toHaveBeenCalled()
  })
  it('enforces revocation and expiry immediately without cached access', async () => {
    await get('app-a/releases').expect(200)
    await keys.revoke(tokens.full.keyId, context)
    await get('app-a/releases').expect(401)
    await source.query(
      'UPDATE ota_api_keys SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE key_id = ?',
      [tokens.publisher.keyId]
    )
    await get('app-a/releases', 'publisher').expect(401)
  })
  it('carries the authenticated key identity into publication audit context', async () => {
    await post('app-a/releases/release-a/disable')
      .set('x-request-id', 'key-audit-test')
      .expect(201)
    expect(releases.setEnabled).toHaveBeenCalledWith(
      'app-a',
      'release-a',
      false,
      expect.objectContaining({
        requestId: 'key-audit-test',
        actorType: 'api_key',
        actorKeyId: tokens.full.keyId,
        actorName: 'full'
      })
    )
  })
  it('authorizes uploads before multipart processing and storage calls', async () => {
    await request(http.getHttpServer())
      .post('/api/v1/manage/apps/app-a/artifacts')
      .set('Authorization', 'Bearer ' + tokens.observer.accessKey)
      .attach('file', Buffer.from('not uploaded'), 'test.zip')
      .expect(403)
    expect(artifacts.uploadArtifact).not.toHaveBeenCalled()
    await request(http.getHttpServer())
      .post('/api/v1/manage/apps/app-b/artifacts')
      .set('Authorization', 'Bearer ' + tokens.publisher.accessKey)
      .attach('file', Buffer.from('test'), 'test.zip')
      .expect(201)
    expect(artifacts.uploadArtifact).toHaveBeenCalledTimes(1)
  })
  it('binds user message targets and all message requests to the path application', async () => {
    await post(
      'app-a/messages/users',
      { userId: 'app-b:windows:1' },
      'messenger'
    ).expect(403)
    expect(gateway.sendUserIdMessage).not.toHaveBeenCalled()
    await post(
      'app-a/messages/users',
      { userId: 'app-a:windows:1' },
      'messenger'
    ).expect(201)
    await post('app-a/messages/application', {
      appName: 'app-b',
      data: 'forged'
    }).expect(400)
    await post('app-c/messages/application', { data: 'forbidden' }).expect(403)
  })
  it('isolates device persistence, replay and ACK for the same uniqueId across applications', async () => {
    await post(
      'app-a/messages/devices',
      { uniqueId: 'same-device', data: '123', resend: true },
      'messenger'
    ).expect(201)
    await post(
      'app-b/messages/devices',
      { uniqueId: 'same-device', data: { private_key: 'B' }, resend: true },
      'messenger'
    ).expect(201)
    const a = await messages.queryUniqueId({
      appName: 'app-a',
      uniqueId: 'same-device'
    })
    const b = await messages.queryUniqueId({
      appName: 'app-b',
      uniqueId: 'same-device'
    })
    expect(a?.data).toBe('123')
    expect(b?.data).toEqual({ private_key: 'B' })
    expect(
      await messages.ackUniqueId({
        appName: 'app-b',
        uniqueId: 'same-device',
        messageId: a!.messageId!
      })
    ).toBe(false)
    expect(
      await messages.ackUniqueId({
        appName: 'app-a',
        uniqueId: 'same-device',
        messageId: a!.messageId!
      })
    ).toBe(true)
    expect(
      await messages.queryUniqueId({
        appName: 'app-b',
        uniqueId: 'same-device'
      })
    ).not.toBeNull()
    expect(gateway.sendUniqueIdMessage).toHaveBeenCalledWith(
      'app-a',
      'same-device',
      expect.any(Object)
    )
  })
  it('allows public update checks without an API key', async () => {
    await request(http.getHttpServer())
      .post('/api/v1/app/apps/app-a/updates/check')
      .send({
        platform: 'windows',
        nativeVersionCode: 100,
        installedReleaseSequence: 0
      })
      .expect(201, { code: 0, data: null })
  })
})
