import { INestApplication, UnauthorizedException } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Server } from 'http'
import request from 'supertest'
import { AuthGuard } from '@/guards/auth.guard'
import { ApiKeyService } from '@/auth/api-key.service'
import { MessageController } from '@/manage/messages/messages.controller'
import { MessageService } from '@/manage/messages/messages.service'
import { configureHttp } from '@/config/http'

describe('application-scoped message HTTP contracts', () => {
  let app: INestApplication<Server>
  const service = {
    sendApplication: jest.fn().mockResolvedValue({ code: 0, data: 'sent' }),
    sendUserId: jest.fn().mockResolvedValue({ code: 0, data: 'sent' }),
    sendUniqueId: jest.fn().mockResolvedValue({ code: 0, data: 'sent' }),
    listSubscribedUserIds: jest.fn().mockResolvedValue({ code: 0, data: [] })
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        { provide: MessageService, useValue: service },
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: ApiKeyService,
          useValue: {
            authenticate: (token: string) => {
              if (token !== 'active') throw new UnauthorizedException()
              return {
                type: 'api_key',
                keyId: 'test-key',
                name: 'test',
                preset: 'full',
                applications: ['app-a']
              }
            },
            markUsed: jest.fn()
          }
        }
      ]
    }).compile()
    app = module.createNestApplication<INestApplication<Server>>({
      logger: false
    })
    configureHttp(app)
    await app.listen(0, '127.0.0.1')
  })
  beforeEach(() => jest.clearAllMocks())
  afterAll(async () => {
    if (app) await app.close()
  })
  const path = '/api/v1/manage/apps/app-a/messages/'
  it.each(['application', 'users', 'devices'])(
    'requires an access key for %s',
    async suffix => {
      await request(app.getHttpServer())
        .post(path + suffix)
        .send({})
        .expect(401)
    }
  )
  it('binds messages to the path application, rejecting body-based application overrides', async () => {
    const body = { data: { business_key: [1, false, null] } }
    await request(app.getHttpServer())
      .post(path + 'application')
      .set('Authorization', 'Bearer active')
      .send(body)
      .expect(201)
    expect(service.sendApplication).toHaveBeenCalledWith('app-a', body)
    for (const field of ['appName', 'otaName'])
      await request(app.getHttpServer())
        .post(path + 'application')
        .set('Authorization', 'Bearer active')
        .send({ [field]: 'app-b', data: 1 })
        .expect(400)
  })
  it('preserves JSON data, including encoded-looking strings, without recursively renaming keys', async () => {
    for (const data of [
      { business_key: 1 },
      [false, 1],
      '{"encoded_key":1}',
      null
    ]) {
      await request(app.getHttpServer())
        .post(path + 'application')
        .set('Authorization', 'Bearer active')
        .send({ data })
        .expect(201)
      expect(service.sendApplication).toHaveBeenLastCalledWith('app-a', {
        data
      })
    }
  })
  it('requires boolean resend flags and bounded identities', async () => {
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(path + 'users')
        .set('Authorization', 'Bearer active')
        .send(body)
    await post({ userId: 'app-a:windows:1', resend: 'true' }).expect(400)
    await post({ userId: 'x'.repeat(192), resend: true }).expect(400)
    await post({ userId: 'app-a:windows:1', resend: true }).expect(201)
    expect(service.sendUserId).toHaveBeenCalledTimes(1)
  })
  it('never expands application scope using a query filter or an unauthorized path', async () => {
    await request(app.getHttpServer())
      .get(path + 'user-id-subscriptions')
      .query({ appName: 'app-b' })
      .set('Authorization', 'Bearer active')
      .expect(200)
    expect(service.listSubscribedUserIds).toHaveBeenCalledWith('app-a')
    await request(app.getHttpServer())
      .get('/api/v1/manage/apps/app-b/messages/user-id-subscriptions')
      .set('Authorization', 'Bearer active')
      .expect(403)
    expect(service.listSubscribedUserIds).toHaveBeenCalledTimes(1)
  })
})
