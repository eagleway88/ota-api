import { WsService } from './ws.service'

describe('WsService.getSubscribedUserIds', () => {
  it('returns unique sorted userIds from active subscription rooms', async () => {
    const service = new WsService({} as never, {} as never)
    service.server = {
      fetchSockets: jest
        .fn()
        .mockResolvedValue([
          { rooms: new Set(['socket-1', 'userId:user-b', 'otaName:desktop']) },
          { rooms: new Set(['socket-2', 'userId:user-a', 'userId:user-b']) }
        ])
    } as never

    await expect(service.getSubscribedUserIds()).resolves.toEqual([
      'user-a',
      'user-b'
    ])
  })

  it('only returns subscriptions with the exact application prefix', async () => {
    const service = new WsService({} as never, {} as never)
    service.server = {
      fetchSockets: jest.fn().mockResolvedValue([
        {
          rooms: new Set([
            'socket-1',
            'userId:eagleway-network:windows:1',
            'userId:eagleway-network-dev:windows:2',
            'userId:other:eagleway-network:3'
          ])
        },
        {
          rooms: new Set(['socket-2', 'userId:eagleway-network:android:4'])
        }
      ])
    } as never

    await expect(
      service.getSubscribedUserIds('eagleway-network')
    ).resolves.toEqual([
      'eagleway-network:android:4',
      'eagleway-network:windows:1'
    ])
  })
})
