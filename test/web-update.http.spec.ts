import { INestApplication } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { Server } from 'http'
import request from 'supertest'
import { UpdateCheckController } from '@/app/updates/update-check.controller'
import { UpdateCheckService } from '@/app/updates/update-check.service'
import { configureHttp } from '@/config/http'
import { Release } from '@/contracts/releases'
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { ReleaseCatalogService } from '@/updates/catalog/release-catalog.service'
import { UpdateQueryService } from '@/updates/update-query.service'

describe('Web update checks and subscriptions', () => {
  let app: INestApplication<Server>
  let query: UpdateQueryService
  const release: Release = {
    appName: 'website',
    releaseId: 'web-release',
    releaseSequence: 1,
    targetVersion: '1.3.11',
    platforms: ['web'],
    architectures: [],
    updateType: 'full',
    scope: 'public',
    enabled: true,
    mandatory: false,
    showUpdateDialog: true
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [UpdateCheckController],
      providers: [
        UpdateCheckService,
        UpdateQueryService,
        {
          provide: ReleaseCatalogService,
          useValue: {
            loadCatalog: jest.fn().mockResolvedValue({
              available: { revision: 1, releases: [release] },
              audience: { revision: 1, userIdsByReleaseId: new Map() }
            })
          }
        }
      ]
    }).compile()
    query = module.get(UpdateQueryService)
    app = module.createNestApplication<INestApplication<Server>>()
    configureHttp(app)
    await app.init()
  })

  afterAll(async () => {
    await app.close()
  })

  it.each([
    ['web', '1.3.10', true],
    ['web', '1.3.11', false],
    ['web', '1.4.0', false],
    ['windows', '1.3.10', false]
  ])(
    'checks %s at %s with update=%s',
    async (platform, currentVersion, available) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/app/apps/website/updates/check')
        .send({ platform, currentVersion })
        .expect(201)
      expect(response.body).toMatchObject({
        code: 0,
        data: available
          ? {
              releaseId: release.releaseId,
              targetVersion: release.targetVersion,
              showUpdateDialog: true,
              mandatory: false
            }
          : null
      })
    }
  )

  it('accepts Web subscriptions and replays the same decision as HTTP', async () => {
    const gateway = new RealtimeGateway(
      query,
      {} as never,
      new ConnectionSubscriptionStore()
    )
    const client = { id: 'web-socket', join: jest.fn(), emit: jest.fn() }
    await expect(
      gateway.handleApplicationSubscribe(client as never, {
        appName: 'website',
        platform: 'web',
        currentVersion: '1.3.10'
      })
    ).resolves.toEqual({ appName: 'website' })
    expect(client.emit).toHaveBeenCalledWith(
      'app:website:update',
      expect.objectContaining({
        releaseId: release.releaseId,
        showUpdateDialog: true
      })
    )
    client.emit.mockClear()
    await gateway.handleApplicationSubscribe(client as never, {
      appName: 'website',
      platform: 'web',
      currentVersion: '1.3.11'
    })
    expect(client.emit).not.toHaveBeenCalledWith(
      'app:website:update',
      expect.objectContaining({ enabled: true })
    )
  })
})
