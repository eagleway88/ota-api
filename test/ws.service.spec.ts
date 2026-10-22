import { WsService } from '@/ws/ws.service'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { DispatchMetrics } from '@/realtime/dispatch/dispatch-progress'

function selected(payload: Record<string, unknown>) {
  return {
    payload,
    decision: {
      release: {
        releaseId: `release-${Number(payload.id)}`,
        releaseSequence: Number(payload.id)
      }
    }
  }
}

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

  it('checkpoints inspected connections, skip reasons and send errors in bounded batches', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    const sockets = new Map<string, ReturnType<typeof createClient>>()
    for (let index = 0; index < 205; index++) {
      const id = `socket-${index}`
      subscriptions.subscribeApplication(id, {
        appName: 'app',
        platform: 'windows',
        nativeVersionCode: index,
        installedReleaseSequence: 0
      })
      sockets.set(id, { ...createClient(), id })
    }
    sockets.delete('socket-1')
    sockets
      .get('socket-0')!
      .emit.mockImplementation(() =>
        subscriptions.unsubscribeApplication('socket-4', 'app')
      )
    sockets.get('socket-2')!.emit.mockImplementation(() => {
      throw new Error('transport private details')
    })
    sockets.get('socket-3')!.emit.mockReturnValue(false)
    const service = new WsService(
      {
        loadCatalog: jest
          .fn()
          .mockResolvedValue({ available: { revision: 1 } }),
        resolveAvailableDecision: jest.fn((query: { ver: number }) =>
          query.ver === 5
            ? {
                payload: null,
                decision: { release: null, skipReason: 'platform_mismatch' }
              }
            : selected({ id: 2000, name: 'app' })
        )
      } as never,
      {} as never,
      subscriptions
    )
    service.server = { sockets: { sockets } } as never
    const checkpoint = jest.fn().mockResolvedValue(true)
    const result = await service.dispatchApplicationUpdate('app', checkpoint)
    expect(
      checkpoint.mock.calls.map(
        ([progress]) => (progress as { scanned: number }).scanned
      )
    ).toEqual([0, 100, 200, 205])
    expect(result).toMatchObject({
      scanned: 205,
      eligible: 202,
      updated: 202,
      revoked: 0,
      emitErrors: 2,
      skipSummary: {
        disconnected: 1,
        subscription_changed: 1,
        platform_mismatch: 1
      },
      releaseSummary: {
        complete: true,
        entries: [
          {
            releaseId: 'release-2000',
            releaseSequence: 2000,
            eligible: 202,
            updated: 202,
            revoked: 0,
            emitErrors: 2
          }
        ]
      }
    })
  })

  it('counts the actual revoked release and retries a failed revoke before sending the new release', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    subscriptions.subscribeApplication('socket-1', {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    })
    const query = {
      loadCatalog: jest.fn().mockResolvedValue({ available: { revision: 1 } }),
      resolveAvailableDecision: jest
        .fn()
        .mockReturnValue(selected({ id: 2000, name: 'app' }))
    }
    const service = new WsService(query as never, {} as never, subscriptions)
    const client = createClient()
    service.server = {
      sockets: { sockets: new Map([[client.id, client]]) }
    } as never
    await service.dispatchApplicationUpdate('app')
    query.resolveAvailableDecision.mockReturnValue(
      selected({ id: 2001, name: 'app' })
    )
    client.emit.mockImplementationOnce(() => {
      throw new Error('send failed')
    })
    const failed = await service.dispatchApplicationUpdate('app')
    expect(failed).toMatchObject({
      eligible: 1,
      updated: 0,
      revoked: 1,
      emitErrors: 1,
      skipSummary: { revoke_emit_failed: 1 }
    })
    expect(failed.releaseSummary.entries).toEqual([
      {
        releaseId: 'release-2001',
        releaseSequence: 2001,
        eligible: 1,
        updated: 0,
        revoked: 0,
        emitErrors: 0
      },
      {
        releaseId: 'release-2000',
        releaseSequence: 2000,
        eligible: 0,
        updated: 0,
        revoked: 1,
        emitErrors: 1
      }
    ])
    expect(await service.dispatchApplicationUpdate('app')).toMatchObject({
      eligible: 1,
      updated: 1,
      revoked: 1,
      emitErrors: 0
    })
    expect(client.emit).toHaveBeenLastCalledWith('app', {
      id: 2001,
      name: 'app'
    })
  })

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
      resolveAvailableDecision: jest.fn((query: { platform: string }) =>
        selected({
          id: query.platform === 'ios' ? 2001 : 2000,
          name: 'app',
          enable: 1
        })
      )
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
    expect(queryService.resolveAvailableDecision).toHaveBeenCalledTimes(1)
  })

  it('recalculates OTA eligibility when user subscription arrives later', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    const catalog = { available: { revision: 1, releases: [] } } as never
    const queryService = {
      loadCatalog: jest.fn().mockResolvedValue(catalog),
      resolveAvailableDecision: jest
        .fn()
        .mockImplementation((query: { userIds: readonly string[] }) =>
          selected({
            id: query.userIds.length ? 2001 : 2000,
            name: 'app',
            enable: 1
          })
        )
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
      resolveAvailableDecision: jest.fn().mockReturnValue(
        selected({
          id: 2000,
          name: 'app'
        })
      )
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

    await expect(
      service.dispatchApplicationUpdate('app')
    ).resolves.toMatchObject({
      scanned: 2,
      updated: 2,
      revoked: 0
    })
    expect(queryService.loadCatalog).toHaveBeenCalledTimes(1)
    expect(queryService.resolveAvailableDecision).toHaveBeenCalledTimes(2)
  })

  it.each([
    { available: 41, audience: 41 },
    { available: 42, audience: 41 }
  ])(
    'rejects a snapshot that differs from the task execution revision: %j',
    async revisions => {
      const queryService = {
        loadCatalog: jest.fn().mockResolvedValue({
          available: { revision: revisions.available, releases: [] },
          audience: {
            revision: revisions.audience,
            userIdsByReleaseId: new Map()
          }
        }),
        resolveAvailableDecision: jest.fn()
      }
      const service = new WsService(
        queryService as never,
        {} as never,
        new ConnectionSubscriptionStore()
      )
      const lease = jest.fn().mockResolvedValue(true)
      await expect(
        service.dispatchApplicationUpdate('app', lease, 42)
      ).rejects.toThrow('catalog revision changed')
      expect(lease).not.toHaveBeenCalled()
      expect(queryService.resolveAvailableDecision).not.toHaveBeenCalled()
    }
  )

  it('validates lease and revision before and after an empty dispatch', async () => {
    const queryService = {
      loadCatalog: jest.fn().mockResolvedValue({
        available: { revision: 42, releases: [] },
        audience: { revision: 42, userIdsByReleaseId: new Map() }
      })
    }
    const service = new WsService(
      queryService as never,
      {} as never,
      new ConnectionSubscriptionStore()
    )
    const lease = jest.fn().mockResolvedValue(true)
    await expect(
      service.dispatchApplicationUpdate('app', lease, 42)
    ).resolves.toEqual(new DispatchMetrics().snapshot())
    expect(lease).toHaveBeenCalledTimes(2)

    lease
      .mockReset()
      .mockResolvedValueOnce(true)
      .mockRejectedValueOnce(new Error('Publish catalog revision changed'))
    await expect(
      service.dispatchApplicationUpdate('app', lease, 42)
    ).rejects.toThrow('catalog revision changed')
    expect(lease).toHaveBeenCalledTimes(2)
  })

  it('does not emit when the lease is already lost', async () => {
    const subscriptions = new ConnectionSubscriptionStore()
    subscriptions.subscribeApplication('socket-1', {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    })
    const queryService = {
      loadCatalog: jest.fn().mockResolvedValue({
        available: { revision: 42, releases: [] },
        audience: { revision: 42, userIdsByReleaseId: new Map() }
      }),
      resolveAvailableDecision: jest.fn()
    }
    const service = new WsService(
      queryService as never,
      {} as never,
      subscriptions
    )
    await expect(
      service.dispatchApplicationUpdate('app', () => Promise.resolve(false), 42)
    ).rejects.toThrow('lease was lost')
    expect(queryService.resolveAvailableDecision).not.toHaveBeenCalled()
  })
})
