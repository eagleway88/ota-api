import { WsService } from './ws.service'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'

describe('WsService.getSubscribedUserIds', () => {
  it('returns unique sorted userIds from active subscription rooms', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    subscriptions.subscribeUserId('socket-1', 'user-b')
    subscriptions.subscribeUserId('socket-2', 'user-a')
    subscriptions.subscribeUserId('socket-2', 'user-b')
    const service = new WsService({} as never, {} as never, subscriptions)

    await expect(service.getSubscribedUserIds()).resolves.toEqual([
      'user-a',
      'user-b'
    ])
  })

  it('only returns subscriptions with the exact application prefix', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    subscriptions.subscribeUserId('socket-1', 'eagleway-network:windows:1')
    subscriptions.subscribeUserId('socket-1', 'eagleway-network-dev:windows:2')
    subscriptions.subscribeUserId('socket-1', 'other:eagleway-network:3')
    subscriptions.subscribeUserId('socket-2', 'eagleway-network:android:4')
    const service = new WsService({} as never, {} as never, subscriptions)

    await expect(
      service.getSubscribedUserIds('eagleway-network')
    ).resolves.toEqual([
      'eagleway-network:android:4',
      'eagleway-network:windows:1'
    ])
  })
})

describe('WsService OTA dispatch', () => {
  function createClient() {
    return {
      id: 'socket-1',
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      emit: jest.fn()
    }
  }

  it('drops a delayed replay after unsubscribe and re-subscribe with another platform', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    const catalog = { available: { revision: 1, releases: [] } } as never
    let finishOld!: (value: unknown) => void
    let signalStarted!: () => void
    const started = new Promise<void>(resolve => {
      signalStarted = resolve
    })
    const oldLoad = new Promise(resolve => {
      finishOld = resolve
    })
    const queryService = {
      loadCatalog: jest
        .fn()
        .mockImplementationOnce(() => {
          signalStarted()
          return oldLoad
        })
        .mockResolvedValue(catalog),
      resolveAvailableVersion: jest.fn((query: { platform: string }) => ({
        id: query.platform === 'ios' ? 2001 : 2000,
        name: 'app',
        enable: 1
      }))
    }
    const service = new WsService(
      queryService as never,
      {} as never,
      subscriptions
    )
    const client = createClient()
    const oldReplay = service.handleOtaNameSubscribe(client as never, {
      otaName: 'app',
      platform: 'windows',
      ver: 100,
      id: 0
    })
    await started
    await service.handleOtaNameUnsubscribe(client as never, { otaName: 'app' })
    await service.handleOtaNameSubscribe(client as never, {
      otaName: 'app',
      platform: 'ios',
      ver: 200,
      id: 0
    })
    finishOld(catalog)
    await oldReplay
    expect(client.emit).toHaveBeenCalledTimes(1)
    expect(client.emit).toHaveBeenCalledWith(
      'app',
      expect.objectContaining({ id: 2001 })
    )
    expect(queryService.resolveAvailableVersion).toHaveBeenCalledTimes(1)
  })

  it('recalculates OTA eligibility when user subscription arrives later', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    const catalog = { available: { revision: 1, releases: [] } } as never
    const queryService = {
      loadCatalog: jest.fn().mockResolvedValue(catalog),
      resolveAvailableVersion: jest
        .fn()
        .mockImplementation((query: { userIds: readonly string[] }) => ({
          id: query.userIds.length ? 2001 : 2000,
          name: 'app',
          enable: 1
        }))
    }
    const lastMessageService = { queryUserId: jest.fn() }
    const service = new WsService(
      queryService as never,
      lastMessageService as never,
      subscriptions
    )
    const client = createClient()

    await service.handleOtaNameSubscribe(client as never, {
      otaName: 'app',
      platform: 'windows',
      ver: 100,
      id: 0
    })
    await service.handleUserIdSubscribe(client as never, {
      userId: 'app:windows:1'
    })

    expect(client.emit).toHaveBeenNthCalledWith(
      1,
      'app',
      expect.objectContaining({ id: 2000 })
    )
    expect(client.emit).toHaveBeenNthCalledWith(
      2,
      'app',
      expect.objectContaining({ id: 2000, enable: 0 })
    )
    expect(client.emit).toHaveBeenNthCalledWith(
      3,
      'app',
      expect.objectContaining({ id: 2001 })
    )
  })

  it('loads one catalog for an application dispatch batch', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    for (const socketId of ['socket-1', 'socket-2']) {
      subscriptions.subscribeApplication(socketId, {
        appName: 'app',
        platform: 'windows',
        nativeVersionCode: 100,
        installedReleaseSequence: 0
      })
    }
    const catalog = { available: { revision: 1, releases: [] } } as never
    const queryService = {
      loadCatalog: jest.fn().mockResolvedValue(catalog),
      resolveAvailableVersion: jest.fn().mockReturnValue({
        id: 2000,
        name: 'app'
      })
    }
    const sockets = new Map([
      ['socket-1', createClient()],
      ['socket-2', { ...createClient(), id: 'socket-2' }]
    ])
    const service = new WsService(
      queryService as never,
      {} as never,
      subscriptions
    )
    service.server = { sockets: { sockets } } as never

    await expect(service.dispatchApplicationUpdate('app')).resolves.toEqual({
      scanned: 2,
      updated: 2,
      revoked: 0
    })
    expect(queryService.loadCatalog).toHaveBeenCalledTimes(1)
    expect(queryService.resolveAvailableVersion).toHaveBeenCalledTimes(2)
  })
})
