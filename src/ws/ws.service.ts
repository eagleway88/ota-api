import { Logger } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { Server, Socket } from 'socket.io'

type OtaMessage = {
  ota: string
  platform?: string
  channel?: string
  ver?: number
  id?: number
}

type UidMessage = {
  uid: string
}

type UniqueIdMessage = {
  uniqueId: string
}

@WebSocketGateway(void 0, {
  cors: '*',
  transports: ['websocket']
})
export class WsService {
  private readonly logger = new Logger(WsService.name, { timestamp: true })

  @WebSocketServer()
  server: Server

  constructor(private readonly otaVersionQueryService: OtaVersionQueryService) { }

  handleConnection(client: Socket) {
    this.logger.log(`client connected: ${client.id}`)
  }

  private getOtaRoom(ota: string) {
    return `ota:${ota}`
  }

  private getUidRoom(uid: string) {
    return `uid:${uid}`
  }

  private getUniqueIdRoom(uniqueId: string) {
    return `uniqueId:${uniqueId}`
  }

  async sendBroadcast(type: string, data?: any, clientId?: string) {
    const ids: Record<string, boolean> = {}
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      if (!clientId || clientId === client.id) {
        const bool = client.emit('message', { type, data })
        ids[client.id] = bool
      }
    }
    return ids
  }

  async sendUidMessage(uid: string, data: any) {
    return this.server.to(this.getUidRoom(uid)).emit(uid, data)
  }

  async sendUniqueIdMessage(uniqueId: string, data: any) {
    return this.server.to(this.getUniqueIdRoom(uniqueId)).emit(uniqueId, data)
  }

  @SubscribeMessage('uid:subscribe')
  async handleUidSubscribe(client: Socket, data: UidMessage) {
    if (!data?.uid) {
      return { event: 'uid:error', data: 'Uid is required' }
    }

    await client.join(this.getUidRoom(data.uid))
    return { event: 'uid:subscribed', data: { uid: data.uid } }
  }

  @SubscribeMessage('uid:unsubscribe')
  async handleUidUnsubscribe(client: Socket, data: UidMessage) {
    if (!data?.uid) {
      return { event: 'uid:error', data: 'Uid is required' }
    }

    await client.leave(this.getUidRoom(data.uid))
    return { event: 'uid:unsubscribed', data: { uid: data.uid } }
  }

  @SubscribeMessage('uniqueId:subscribe')
  async handleUniqueIdSubscribe(client: Socket, data: UniqueIdMessage) {
    if (!data?.uniqueId) {
      return { event: 'uniqueId:error', data: 'UniqueId is required' }
    }

    await client.join(this.getUniqueIdRoom(data.uniqueId))
    return { event: 'uniqueId:subscribed', data: { uniqueId: data.uniqueId } }
  }

  @SubscribeMessage('uniqueId:unsubscribe')
  async handleUniqueIdUnsubscribe(client: Socket, data: UniqueIdMessage) {
    if (!data?.uniqueId) {
      return { event: 'uniqueId:error', data: 'UniqueId is required' }
    }

    await client.leave(this.getUniqueIdRoom(data.uniqueId))
    return { event: 'uniqueId:unsubscribed', data: { uniqueId: data.uniqueId } }
  }

  async sendOtaMessage(ota: string, data: any) {
    return this.server.to(this.getOtaRoom(ota)).emit(ota, data)
  }

  @SubscribeMessage('ota:subscribe')
  async handleOtaSubscribe(client: Socket, data: OtaMessage) {
    if (!data?.ota) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.join(this.getOtaRoom(data.ota))

    try {
      const latestOtaMessage = await this.otaVersionQueryService.findLatestAvailableVersion({
        name: data.ota,
        platform: data.platform!,
        channel: data.channel,
        ver: data.ver!,
        id: data.id
      })
      if (latestOtaMessage) {
        client.emit(data.ota, latestOtaMessage)
      }
    } catch (error) {
      this.logger.error(`ota replay failed: ${data.ota}`, error instanceof Error ? error.stack : undefined)
    }

    return { event: 'ota:subscribed', data: { ota: data.ota } }
  }

  @SubscribeMessage('ota:unsubscribe')
  async handleOtaUnsubscribe(client: Socket, data: OtaMessage) {
    if (!data?.ota) {
      return { event: 'ota:error', data: 'Ota is required' }
    }

    await client.leave(this.getOtaRoom(data.ota))
    return { event: 'ota:unsubscribed', data: { ota: data.ota } }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }
}
