import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import { LastMessageService } from '@/messaging/last-message.service'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { UpdateQueryService } from '@/updates/update-query.service'
import type { Socket, Server } from 'socket.io'

describe('application-scoped device WebSocket messages', () => {
  const envelope = {
    messageId: 'message-a',
    data: '123',
    ackRequired: true,
    updatedAt: new Date().toISOString(),
    expiresAt: null
  }
  function setup() {
    const messages = {
      queryUniqueId: jest.fn().mockResolvedValue(envelope),
      ackUniqueId: jest.fn().mockResolvedValue(true)
    }
    const subscriptions = new ConnectionSubscriptionStore()
    const gateway = new RealtimeGateway(
      {} as UpdateQueryService,
      messages as unknown as LastMessageService,
      subscriptions
    )
    const clientEmit = jest.fn()
    const client = {
      id: 'socket-a',
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      emit: clientEmit
    } as unknown as Socket
    const emit = jest.fn(),
      to = jest.fn(() => ({ emit }))
    gateway.server = { to } as unknown as Server
    return { gateway, client, clientEmit, messages, subscriptions, emit, to }
  }
  it('requires an application for subscriptions and refuses ambiguous global device replay', async () => {
    const f = setup()
    for (const appName of ['', '*', 'a:b']) {
      expect(
        await f.gateway.handleUniqueIdSubscribe(f.client, {
          appName,
          uniqueId: 'device'
        })
      ).toHaveProperty('error')
    }
    expect(f.messages.queryUniqueId).not.toHaveBeenCalled()
  })
  it('namespaces rooms and replay events by both application and unchanged device identifier', async () => {
    const f = setup()
    await f.gateway.handleUniqueIdSubscribe(f.client, {
      appName: 'app-a',
      uniqueId: 'same-device'
    })
    await f.gateway.handleUniqueIdSubscribe(f.client, {
      appName: 'app-b',
      uniqueId: 'same-device'
    })
    expect(f.messages.queryUniqueId).toHaveBeenCalledWith({
      appName: 'app-a',
      uniqueId: 'same-device'
    })
    expect(f.clientEmit).toHaveBeenCalledWith(
      'device:app-a:same-device',
      envelope
    )
    expect(f.clientEmit).toHaveBeenCalledWith(
      'device:app-b:same-device',
      envelope
    )
    await f.gateway.sendUniqueIdMessage('app-a', 'same-device', envelope)
    await f.gateway.sendUniqueIdMessage('app-b', 'same-device', envelope)
    expect(f.to.mock.calls[0]).not.toEqual(f.to.mock.calls[1])
  })
  it('requires a matching device subscription before ACK and keeps another application subscribed', async () => {
    const f = setup()
    await f.gateway.handleUniqueIdSubscribe(f.client, {
      appName: 'app-a',
      uniqueId: 'same'
    })
    await f.gateway.handleUniqueIdSubscribe(f.client, {
      appName: 'app-b',
      uniqueId: 'same'
    })
    await f.gateway.handleUniqueIdUnsubscribe(f.client, {
      appName: 'app-a',
      uniqueId: 'same'
    })
    expect(
      await f.gateway.handleUniqueIdAck(f.client, {
        appName: 'app-a',
        uniqueId: 'same',
        messageId: 'old'
      })
    ).toHaveProperty('error')
    expect(f.messages.ackUniqueId).not.toHaveBeenCalled()
    expect(
      await f.gateway.handleUniqueIdAck(f.client, {
        appName: 'app-b',
        uniqueId: 'same',
        messageId: 'message-a'
      })
    ).toHaveProperty('acked', true)
    expect(f.messages.ackUniqueId).toHaveBeenCalledWith({
      appName: 'app-b',
      uniqueId: 'same',
      messageId: 'message-a'
    })
  })
})
