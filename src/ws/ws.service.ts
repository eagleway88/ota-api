import { Logger } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import {
  OtaVersionQueryService,
  ReleaseCatalog
} from '@/compat/legacy/http/version/ota-version-query.service'
import { Server, Socket } from 'socket.io'
import { LastMessageService } from '@/messaging/last-message.service'
import {
  AckUniqueIdDto,
  AckUserIdDto,
  TargetedMessageEnvelope
} from '@/compat/legacy/http/message/message.dto'
import {
  ApplicationSubscriber,
  ConnectionSubscriptionStore
} from '@/realtime/subscriptions/connection-subscription.store'

type OtaNameMessage = {
  otaName: string
  platform?: string
  architecture?: string
  channel?: string
  ver?: number
  id?: number
}

type UserIdMessage = {
  /** 使用 `otaName:platform:userId` 形式区分应用和平台。 */
  userId: string
}

type UniqueIdMessage = {
  uniqueId: string
}

type ErrorAckResponse = {
  error: string
}

type UserIdSubscriptionAckResponse = {
  uid: string
}

type UniqueIdSubscriptionAckResponse = {
  uniqueId: string
}

type OtaNameSubscriptionAckResponse = {
  ota: string
}

type UserIdAckResponse = {
  uid: string
  messageId: string
  acked: boolean
  clientId: string
}

type UniqueIdAckResponse = {
  uniqueId: string
  messageId: string
  acked: boolean
  clientId: string
}

@WebSocketGateway(void 0, {
  cors: '*',
  transports: ['websocket']
})
export class WsService {
  private readonly logger = new Logger(WsService.name, { timestamp: true })

  @WebSocketServer()
  server: Server

  private readonly deliveredReleases = new Map<
    string,
    Map<string, Record<string, unknown>>
  >()

  constructor(
    private readonly otaVersionQueryService: OtaVersionQueryService,
    private readonly lastMessageService: LastMessageService,
    private readonly subscriptions: ConnectionSubscriptionStore = new ConnectionSubscriptionStore()
  ) {}

  handleConnection(client: Socket) {
    this.subscriptions.connect(client.id)
    this.logger.log(`client connected: ${client.id}`)
  }

  handleDisconnect(client: Socket) {
    this.subscriptions.disconnect(client.id)
    this.deliveredReleases.delete(client.id)
    this.logger.log(`client disconnected: ${client.id}`)
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

  async sendMessage(data?: unknown) {
    const ids: Record<string, boolean> = {}
    const sockets = await this.server.fetchSockets()
    for (const client of sockets) {
      const bool = client.emit('message', data)
      ids[client.id] = bool
    }
    return ids
  }

  sendApplicationMessage(otaName: string, data: unknown) {
    return Promise.resolve(
      this.server.to(this.getOtaNameRoom(otaName)).emit(otaName, data)
    )
  }

  async dispatchApplicationUpdate(
    otaName: string,
    isLeaseValid?: () => Promise<boolean>
  ) {
    const catalog = await this.otaVersionQueryService.loadCatalog(otaName, true)
    const subscribers = this.subscriptions.getApplicationSubscribers(otaName)
    const result = { scanned: subscribers.length, updated: 0, revoked: 0 }

    for (let index = 0; index < subscribers.length; index += 1) {
      if (index % 100 === 0 && isLeaseValid && !(await isLeaseValid())) {
        throw new Error('Publish task lease was lost')
      }
      const emitted = this.emitCurrentDecision(
        subscribers[index],
        catalog,
        true
      )
      result.updated += emitted.updated
      result.revoked += emitted.revoked
      if ((index + 1) % 100 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }
    return result
  }

  sendUserIdMessage(userId: string, data: TargetedMessageEnvelope) {
    return Promise.resolve(
      this.server.to(this.getUserIdRoom(userId)).emit(userId, data)
    )
  }

  sendUniqueIdMessage(uniqueId: string, data: TargetedMessageEnvelope) {
    return Promise.resolve(
      this.server.to(this.getUniqueIdRoom(uniqueId)).emit(uniqueId, data)
    )
  }

  getSubscribedUserIds(name?: string) {
    return Promise.resolve(this.subscriptions.getSubscribedUserIds(name))
  }

  @SubscribeMessage('userId:subscribe')
  async handleUserIdSubscribe(
    client: Socket,
    data: UserIdMessage
  ): Promise<UserIdSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.userId) {
      return { error: 'UserId is required' }
    }

    await client.join(this.getUserIdRoom(data.userId))
    this.subscriptions.subscribeUserId(client.id, data.userId)

    try {
      const msg = await this.lastMessageService.queryUserId({
        userId: data.userId
      })
      if (msg) {
        client.emit(data.userId, msg)
      }
    } catch (error) {
      this.logger.error(
        `userId replay failed: ${data.userId}`,
        error instanceof Error ? error.stack : undefined
      )
    }

    await this.recomputeConnectionApplications(client)

    return { uid: data.userId }
  }

  @SubscribeMessage('userId:unsubscribe')
  async handleUuserIdUnsubscribe(
    client: Socket,
    data: UserIdMessage
  ): Promise<UserIdSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.userId) {
      return { error: 'UserId is required' }
    }

    await client.leave(this.getUserIdRoom(data.userId))
    this.subscriptions.unsubscribeUserId(client.id, data.userId)
    await this.recomputeConnectionApplications(client)
    return { uid: data.userId }
  }

  @SubscribeMessage('uniqueId:subscribe')
  async handleUniqueIdSubscribe(
    client: Socket,
    data: UniqueIdMessage
  ): Promise<UniqueIdSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.uniqueId) {
      return { error: 'UniqueId is required' }
    }

    await client.join(this.getUniqueIdRoom(data.uniqueId))
    this.subscriptions.subscribeUniqueId(client.id, data.uniqueId)

    try {
      const msg = await this.lastMessageService.queryUniqueId({
        uniqueId: data.uniqueId
      })
      if (msg) {
        client.emit(data.uniqueId, msg)
      }
    } catch (error) {
      this.logger.error(
        `uniqueId replay failed: ${data.uniqueId}`,
        error instanceof Error ? error.stack : undefined
      )
    }

    return { uniqueId: data.uniqueId }
  }

  @SubscribeMessage('uniqueId:unsubscribe')
  async handleUniqueIdUnsubscribe(
    client: Socket,
    data: UniqueIdMessage
  ): Promise<UniqueIdSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.uniqueId) {
      return { error: 'UniqueId is required' }
    }

    await client.leave(this.getUniqueIdRoom(data.uniqueId))
    this.subscriptions.unsubscribeUniqueId(client.id, data.uniqueId)
    return { uniqueId: data.uniqueId }
  }

  @SubscribeMessage('otaName:subscribe')
  async handleOtaNameSubscribe(
    client: Socket,
    data: OtaNameMessage
  ): Promise<OtaNameSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.otaName) {
      return { error: 'OtaName is required' }
    }

    await client.join(this.getOtaNameRoom(data.otaName))
    const nativeVersionCode = Number(data.ver)
    if (!data.platform || !Number.isFinite(nativeVersionCode)) {
      this.subscriptions.unsubscribeApplication(client.id, data.otaName)
      this.deliveredReleases.get(client.id)?.delete(data.otaName)
      return { ota: data.otaName }
    }
    const subscriber = this.subscriptions.subscribeApplication(client.id, {
      appName: data.otaName,
      platform: data.platform,
      architecture: data.architecture,
      distributionChannel: data.channel,
      nativeVersionCode,
      installedReleaseSequence: Number(data.id) || 0
    })

    try {
      const catalog = await this.otaVersionQueryService.loadCatalog(
        data.otaName
      )
      this.emitCurrentDecision(subscriber, catalog, true, client)
    } catch (error) {
      this.logger.error(
        `otaName replay failed: ${data.otaName}`,
        error instanceof Error ? error.stack : undefined
      )
    }

    return { ota: data.otaName }
  }

  @SubscribeMessage('otaName:unsubscribe')
  async handleOtaNameUnsubscribe(
    client: Socket,
    data: OtaNameMessage
  ): Promise<OtaNameSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.otaName) {
      return { error: 'OtaName is required' }
    }

    await client.leave(this.getOtaNameRoom(data.otaName))
    this.subscriptions.unsubscribeApplication(client.id, data.otaName)
    this.deliveredReleases.get(client.id)?.delete(data.otaName)
    return { ota: data.otaName }
  }

  @SubscribeMessage('userId:ack')
  async handleUserIdAck(
    client: Socket,
    data: AckUserIdDto
  ): Promise<UserIdAckResponse | ErrorAckResponse> {
    if (!data?.userId || !data?.messageId) {
      return { error: 'UserId and messageId are required' }
    }

    const acked = await this.lastMessageService.ackUserId(data)
    return {
      uid: data.userId,
      messageId: data.messageId,
      acked,
      clientId: client.id
    }
  }

  @SubscribeMessage('uniqueId:ack')
  async handleUniqueIdAck(
    client: Socket,
    data: AckUniqueIdDto
  ): Promise<UniqueIdAckResponse | ErrorAckResponse> {
    if (!data?.uniqueId || !data?.messageId) {
      return { error: 'UniqueId and messageId are required' }
    }

    const acked = await this.lastMessageService.ackUniqueId(data)
    return {
      uniqueId: data.uniqueId,
      messageId: data.messageId,
      acked,
      clientId: client.id
    }
  }

  @SubscribeMessage('message')
  handleMessage(client: Socket, data: string) {
    return { event: 'message', data: { type: data, data: client.id } }
  }

  private async recomputeConnectionApplications(client: Socket) {
    const appNames = this.subscriptions.getConnectionApplications(client.id)
    for (const appName of appNames) {
      const subscriber = this.subscriptions.getApplicationSubscriber(
        client.id,
        appName
      )
      if (!subscriber) {
        continue
      }
      const catalog = await this.otaVersionQueryService.loadCatalog(appName)
      this.emitCurrentDecision(subscriber, catalog, false, client)
    }
  }

  private emitCurrentDecision(
    subscriber: ApplicationSubscriber,
    catalog: ReleaseCatalog,
    force: boolean,
    knownClient?: Socket
  ) {
    const result = { updated: 0, revoked: 0 }
    if (!this.subscriptions.isCurrent(subscriber)) {
      return result
    }

    const client =
      knownClient ?? this.server.sockets.sockets.get(subscriber.socketId)
    if (!client) {
      return result
    }
    const application = subscriber.application
    const payload = this.otaVersionQueryService.resolveAvailableVersion(
      {
        name: application.appName,
        platform: application.platform,
        architecture: application.architecture,
        channel: application.distributionChannel,
        ver: application.nativeVersionCode,
        id: application.installedReleaseSequence,
        userIds: Array.from(subscriber.userIds)
      },
      catalog
    )
    if (!this.subscriptions.isCurrent(subscriber)) {
      return result
    }

    const socketDeliveries =
      this.deliveredReleases.get(subscriber.socketId) ??
      new Map<string, Record<string, unknown>>()
    const previous = socketDeliveries.get(application.appName)
    const previousId = Number(previous?.id)
    const nextId = Number(payload?.id)

    if (previous && (!payload || previousId !== nextId)) {
      client.emit(application.appName, { ...previous, enable: 0 })
      socketDeliveries.delete(application.appName)
      result.revoked += 1
    }
    if (payload && (force || previousId !== nextId)) {
      client.emit(application.appName, payload)
      socketDeliveries.set(application.appName, payload)
      result.updated += 1
    }
    if (socketDeliveries.size) {
      this.deliveredReleases.set(subscriber.socketId, socketDeliveries)
    } else {
      this.deliveredReleases.delete(subscriber.socketId)
    }
    return result
  }
}
