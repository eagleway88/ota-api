import { INestApplication, UnauthorizedException } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { Test } from '@nestjs/testing'
import { Server } from 'http'
import request from 'supertest'
import { AuthGuard } from '@/guards/auth.guard'
import { AuthService } from '@/auth/auth.service'
import { MessageController } from '@/manage/messages/messages.controller'
import { MessageService } from '@/manage/messages/messages.service'
import { configureHttp } from '@/config/http'

describe('formal message HTTP contracts', () => {
  let app: INestApplication<Server>
  const service = {
    sendGlobal: jest.fn().mockResolvedValue({ code: 0, data: 'sent' }),
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
          provide: AuthService,
          useValue: {
            authenticate: (token: string) => {
              if (token !== 'active') throw new UnauthorizedException()
              return { sub: 1, sid: 'session', username: 'admin' }
            }
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

  it.each(['global', 'applications', 'users', 'devices'])(
    'requires an active administrator session for %s',
    async path => {
      await request(app.getHttpServer())
        .post('/api/v1/manage/messages/' + path)
        .send({})
        .expect(401)
    }
  )

  it('accepts appName only and does not silently translate obsolete application fields', async () => {
    const body = { appName: 'app-a', data: { business_key: [1, false, null] } }
    await request(app.getHttpServer())
      .post('/api/v1/manage/messages/applications')
      .set('Authorization', 'Bearer active')
      .send(body)
      .expect(201)
    expect(service.sendApplication).toHaveBeenCalledWith(
      expect.any(Object),
      body
    )
    await request(app.getHttpServer())
      .post('/api/v1/manage/messages/applications')
      .set('Authorization', 'Bearer active')
      .send({ otaName: 'app-a', data: 1 })
      .expect(400)
    expect(service.sendApplication).toHaveBeenCalledTimes(1)
  })

  it('preserves arbitrary JSON data without recursively renaming keys or parsing strings', async () => {
    for (const data of [
      { business_key: 1 },
      [false, 1],
      '{"encoded_key":1}',
      null
    ]) {
      await request(app.getHttpServer())
        .post('/api/v1/manage/messages/global')
        .set('Authorization', 'Bearer active')
        .send({ data })
        .expect(201)
      expect(service.sendGlobal).toHaveBeenLastCalledWith(expect.any(Object), {
        data
      })
    }
  })

  it('requires a real boolean resend flag and bounded targeted identities', async () => {
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/v1/manage/messages/users')
        .set('Authorization', 'Bearer active')
        .send(body)
    await post({ userId: 'app-a:windows:1', resend: 'true' }).expect(400)
    await post({ userId: 'x'.repeat(192), resend: true }).expect(400)
    await post({ userId: 'app-a:windows:1', resend: true }).expect(201)
    expect(service.sendUserId).toHaveBeenCalledTimes(1)
  })

  it('uses the explicit appName subscription filter and rejects obsolete or repeated filters', async () => {
    const get = () =>
      request(app.getHttpServer())
        .get('/api/v1/manage/messages/user-id-subscriptions')
        .set('Authorization', 'Bearer active')
    await get().query({ appName: 'app-a' }).expect(200)
    expect(service.listSubscribedUserIds).toHaveBeenCalledWith(
      expect.any(Object),
      'app-a'
    )
    await get().query({ name: 'app-a' }).expect(400)
    await get().query('appName=app-a&appName=app-b').expect(400)
    expect(service.listSubscribedUserIds).toHaveBeenCalledTimes(1)
  })
})
