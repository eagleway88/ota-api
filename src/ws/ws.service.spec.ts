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

  it('only returns subscription rooms containing the provided name', async () => {
    const service = new WsService({} as never, {} as never)
    service.server = {
      fetchSockets: jest.fn().mockResolvedValue([
        {
          rooms: new Set([
            'socket-1',
            'userId:desktop_user-a',
            'userId:mobile_user-b'
          ])
        },
        { rooms: new Set(['socket-2', 'userId:desktop_user-c']) }
      ])
    } as never

    await expect(service.getSubscribedUserIds('desktop')).resolves.toEqual([
      'desktop_user-a',
      'desktop_user-c'
    ])
  })
})
