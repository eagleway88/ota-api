import { Logger } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { Server, Socket } from 'socket.io'
import { LastMessageService } from '@/api/message/last-message.service'

type OtaNameMessage = {
  otaName: string
  platform?: string
  architecture?: string
  channel?: string
  ver?: number
  id?: number
}

type UserIdMessage = {
  /** 可能会有多个项目对接，所以userId最好等于`otaName_userId`这样的形式订阅 */
  userId: string
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

  constructor(
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly lastMessageService: LastMessageService
  ) { }

  handleConnection(client: Socket) {
    this.logger.log(`client connected: ${client.id}`)
  }

  private getContent(content: string) {
    try {
      return JSON.parse(content)
    } catch (e) {
      return content
    }
  }

  private getOtaNameRoom(otaName: string) {
    return `otaName:${otaName}`
  }

  private getUserIdRoom(userId: string) {
    return `userId:${userId}`
  }

  private getUniqueIdRoom(uniqueId: string) {
    return `uniqueId:${uniqueId}`
  }

  async sendMessage(type: string, data?: any) {
    const ids: Record<string, boolean> = {}
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      const bool = client.emit('message', { type, data })
      ids[client.id] = bool
    }
    return ids
  }

  async sendOtaNameMessage(otaName: string, data: any) {
    return this.server.to(this.getOtaNameRoom(otaName)).emit(otaName, data)
  }

  async sendUserIdMessage(userId: string, data: any) {
    return this.server.to(this.getUserIdRoom(userId)).emit(userId, data)
  }

  async sendUniqueIdMessage(uniqueId: string, data: any) {
    return this.server.to(this.getUniqueIdRoom(uniqueId)).emit(uniqueId, data)
  }

  @SubscribeMessage('userId:subscribe')
  async handleUserIdSubscribe(client: Socket, data: UserIdMessage) {
    if (!data?.userId) {
      return { event: 'userId:error', data: 'UserId is required' }
    }

    await client.join(this.getUserIdRoom(data.userId))

    try {
      const msg = await this.lastMessageService.queryUserId({ userId: data.userId })
      if (msg && msg.content) {
        client.emit(data.userId, this.getContent(msg.content))
      }
    } catch (error) {
      this.logger.error(`userId replay failed: ${data.userId}`, error instanceof Error ? error.stack : undefined)
    }

    return { event: 'userId:subscribed', data: { uid: data.userId } }
  }

  @SubscribeMessage('userId:unsubscribe')
  async handleUuserIdUnsubscribe(client: Socket, data: UserIdMessage) {
    if (!data?.userId) {
      return { event: 'userId:error', data: 'UserId is required' }
    }

    await client.leave(this.getUserIdRoom(data.userId))
    return { event: 'userId:unsubscribed', data: { uid: data.userId } }
  }

  @SubscribeMessage('uniqueId:subscribe')
  async handleUniqueIdSubscribe(client: Socket, data: UniqueIdMessage) {
    if (!data?.uniqueId) {
      return { event: 'uniqueId:error', data: 'UniqueId is required' }
    }

    await client.join(this.getUniqueIdRoom(data.uniqueId))

    try {
      const msg = await this.lastMessageService.queryUniqueId({ uniqueId: data.uniqueId })
      if (msg && msg.content) {
        client.emit(data.uniqueId, this.getContent(msg.content))
      }
    } catch (error) {
      this.logger.error(`uniqueId replay failed: ${data.uniqueId}`, error instanceof Error ? error.stack : undefined)
    }

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

  @SubscribeMessage('otaName:subscribe')
  async handleOtaNameSubscribe(client: Socket, data: OtaNameMessage) {
    if (!data?.otaName) {
      return { event: 'otaName:error', data: 'OtaName is required' }
    }

    await client.join(this.getOtaNameRoom(data.otaName))

    try {
      const latestOtaMessage = await this.otaVersionQueryService.findLatestAvailableVersion({
        name: data.otaName,
        platform: data.platform!,
        architecture: data.architecture,
        channel: data.channel,
        ver: data.ver!,
        id: data.id
      })
      if (latestOtaMessage) {
        client.emit(data.otaName, latestOtaMessage)
      }
    } catch (error) {
      this.logger.error(`otaName replay failed: ${data.otaName}`, error instanceof Error ? error.stack : undefined)
    }

    return { event: 'otaName:subscribed', data: { ota: data.otaName } }
  }

  @SubscribeMessage('otaName:unsubscribe')
  async handleOtaNameUnsubscribe(client: Socket, data: OtaNameMessage) {
    if (!data?.otaName) {
      return { event: 'otaName:error', data: 'OtaName is required' }
    }

    await client.leave(this.getOtaNameRoom(data.otaName))
    return { event: 'otaName:unsubscribed', data: { ota: data.otaName } }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }
}
