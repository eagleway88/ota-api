import { PlatformType } from '@/contracts/release-values'
import { parseUserId } from '@/contracts/user-id'
import { validDeviceTarget } from '@/realtime/protocol.dto'
import { Logger } from '@nestjs/common'
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets'
import { SubscribeMessage } from '@nestjs/websockets'
import {
  UpdateQueryService,
  ReleaseCatalog
} from '@/updates/update-query.service'
import { Server, Socket } from 'socket.io'
import { LastMessageService } from '@/messaging/last-message.service'
import { AckUniqueIdDto, AckUserIdDto } from '@/realtime/protocol.dto'
import type { TargetedMessageEnvelope } from '@/contracts/messaging'
import {
  ApplicationSubscriber,
  ConnectionSubscriptionStore
} from '@/realtime/subscriptions/connection-subscription.store'
import {
  DispatchMetrics,
  DispatchProgress,
  DispatchRelease
} from '@/realtime/dispatch/dispatch-progress'

type DeliveredRelease = DispatchRelease & { payload: Record<string, unknown> }

type ApplicationSubscription = {
  appName: string
  platform: string
  architecture?: string
  distributionChannel?: string
  nativeVersionCode: number
  installedReleaseSequence?: number
}

type UserIdMessage = {
  /** 使用 `appName:platform:userId` 形式区分应用和平台。 */
  userId: string
}

type UniqueIdMessage = {
  appName: string
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

type ApplicationSubscriptionAckResponse = {
  appName: string
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
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name, {
    timestamp: true
  })

  @WebSocketServer()
  server: Server

  private readonly deliveredReleases = new Map<
    string,
    Map<string, DeliveredRelease>
  >()

  constructor(
    private readonly otaVersionQueryService: UpdateQueryService,
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

  private getApplicationRoom(appName: string) {
    return `appName:${appName}`
  }

  private getUserIdRoom(userId: string) {
    return `userId:${userId}`
  }

  private getUniqueIdRoom(appName: string, uniqueId: string) {
    return 'uniqueId:' + JSON.stringify([appName, uniqueId])
  }

  sendApplicationMessage(appName: string, data: unknown) {
    return Promise.resolve(
      this.server
        .to(this.getApplicationRoom(appName))
        .emit('app:' + appName + ':message', data)
    )
  }

  async dispatchApplicationUpdate(
    appName: string,
    isLeaseValid?: (progress: DispatchProgress) => Promise<boolean>,
    expectedRevision?: number
  ) {
    const catalog = await this.otaVersionQueryService.loadCatalog(appName, true)
    if (
      expectedRevision !== undefined &&
      (catalog.available.revision !== expectedRevision ||
        catalog.audience.revision !== expectedRevision)
    ) {
      throw new Error('Publish catalog revision changed before dispatch')
    }
    const metrics = new DispatchMetrics()
    if (isLeaseValid && !(await isLeaseValid(metrics.snapshot()))) {
      throw new Error('Publish task lease was lost')
    }
    const subscribers = this.subscriptions.getApplicationSubscribers(appName)
    for (let index = 0; index < subscribers.length; index += 1) {
      if (
        index > 0 &&
        index % 100 === 0 &&
        isLeaseValid &&
        !(await isLeaseValid(metrics.snapshot()))
      ) {
        throw new Error('Publish task lease was lost')
      }
      this.emitCurrentDecision(
        subscribers[index],
        catalog,
        true,
        undefined,
        metrics
      )
      if ((index + 1) % 100 === 0) {
        await new Promise<void>(resolve => setImmediate(resolve))
      }
    }
    // Validate even an empty batch and detect changes during the final chunk.
    if (isLeaseValid && !(await isLeaseValid(metrics.snapshot()))) {
      throw new Error('Publish task lease was lost')
    }
    return metrics.snapshot()
  }

  sendUserIdMessage(userId: string, data: TargetedMessageEnvelope) {
    return Promise.resolve(
      this.server.to(this.getUserIdRoom(userId)).emit(userId, data)
    )
  }

  sendUniqueIdMessage(
    appName: string,
    uniqueId: string,
    data: TargetedMessageEnvelope
  ) {
    return Promise.resolve(
      this.server
        .to(this.getUniqueIdRoom(appName, uniqueId))
        .emit('device:' + appName + ':' + uniqueId, data)
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
    if (!parseUserId(data?.userId)) {
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
    if (!validDeviceTarget(data)) {
      return { error: 'UniqueId is required' }
    }

    await client.join(this.getUniqueIdRoom(data.appName, data.uniqueId))
    this.subscriptions.subscribeUniqueId(client.id, data.appName, data.uniqueId)

    try {
      const msg = await this.lastMessageService.queryUniqueId({
        appName: data.appName,
        uniqueId: data.uniqueId
      })
      if (msg) {
        client.emit('device:' + data.appName + ':' + data.uniqueId, msg)
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
    if (!validDeviceTarget(data)) {
      return { error: 'UniqueId is required' }
    }

    await client.leave(this.getUniqueIdRoom(data.appName, data.uniqueId))
    this.subscriptions.unsubscribeUniqueId(
      client.id,
      data.appName,
      data.uniqueId
    )
    return { uniqueId: data.uniqueId }
  }

  @SubscribeMessage('app:subscribe')
  async handleApplicationSubscribe(
    client: Socket,
    data: ApplicationSubscription
  ): Promise<ApplicationSubscriptionAckResponse | ErrorAckResponse> {
    const fields = [
      'appName',
      'platform',
      'architecture',
      'distributionChannel',
      'nativeVersionCode',
      'installedReleaseSequence'
    ]
    const integer = (v: unknown) =>
      Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 2147483647
    if (
      !data ||
      Object.keys(data).some(k => !fields.includes(k)) ||
      typeof data.appName !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(data.appName) ||
      !Object.values(PlatformType).includes(data.platform as PlatformType) ||
      !integer(data.nativeVersionCode) ||
      (data.installedReleaseSequence !== undefined &&
        !integer(data.installedReleaseSequence)) ||
      [data.architecture, data.distributionChannel].some(
        v => v !== undefined && (typeof v !== 'string' || v.length > 128)
      )
    )
      return { error: 'Invalid application subscription' }
    await client.join(this.getApplicationRoom(data.appName))
    const nativeVersionCode = data.nativeVersionCode
    const subscriber = this.subscriptions.subscribeApplication(client.id, {
      appName: data.appName,
      platform: data.platform,
      architecture: data.architecture,
      distributionChannel: data.distributionChannel,
      nativeVersionCode,
      installedReleaseSequence: Number(data.installedReleaseSequence) || 0
    })

    try {
      const catalog = await this.otaVersionQueryService.loadCatalog(
        data.appName
      )
      this.emitCurrentDecision(subscriber, catalog, true, client)
    } catch (error) {
      this.logger.error(
        `appName replay failed: ${data.appName}`,
        error instanceof Error ? error.stack : undefined
      )
    }

    return { appName: data.appName }
  }

  @SubscribeMessage('app:unsubscribe')
  async handleApplicationUnsubscribe(
    client: Socket,
    data: Pick<ApplicationSubscription, 'appName'>
  ): Promise<ApplicationSubscriptionAckResponse | ErrorAckResponse> {
    if (!data?.appName) {
      return { error: 'Application is required' }
    }

    await client.leave(this.getApplicationRoom(data.appName))
    this.subscriptions.unsubscribeApplication(client.id, data.appName)
    this.deliveredReleases.get(client.id)?.delete(data.appName)
    return { appName: data.appName }
  }

  @SubscribeMessage('userId:ack')
  async handleUserIdAck(
    client: Socket,
    data: AckUserIdDto
  ): Promise<UserIdAckResponse | ErrorAckResponse> {
    if (
      !data?.userId ||
      !data?.messageId ||
      !this.subscriptions.hasUserId(client.id, data.userId)
    ) {
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
    if (
      !validDeviceTarget(data) ||
      !data?.messageId ||
      !this.subscriptions.hasUniqueId(client.id, data.appName, data.uniqueId)
    ) {
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
    knownClient?: Socket,
    metrics = new DispatchMetrics()
  ) {
    metrics.scan()
    if (!this.subscriptions.isCurrent(subscriber)) {
      metrics.skip('subscription_changed')
      return
    }

    const client =
      knownClient ?? this.server.sockets.sockets.get(subscriber.socketId)
    if (!client) {
      metrics.skip('disconnected')
      return
    }
    const application = subscriber.application
    const { payload, decision } =
      this.otaVersionQueryService.resolveAvailableDecision(
        {
          appName: application.appName,
          platform: application.platform,
          architecture: application.architecture,
          distributionChannel: application.distributionChannel,
          nativeVersionCode: application.nativeVersionCode,
          installedReleaseSequence: application.installedReleaseSequence,
          userIds: Array.from(subscriber.userIds)
        },
        catalog
      )
    if (decision.release) metrics.count('eligible', decision.release)
    if (!this.subscriptions.isCurrent(subscriber)) {
      metrics.skip('subscription_changed')
      return
    }
    if (!payload) metrics.skip(decision.skipReason ?? 'already_current')

    const socketDeliveries =
      this.deliveredReleases.get(subscriber.socketId) ??
      new Map<string, DeliveredRelease>()
    const previous = socketDeliveries.get(application.appName)
    const previousId = previous?.releaseSequence
    const nextId = decision.release?.releaseSequence

    const emit = (
      release: DispatchRelease,
      data: Record<string, unknown>,
      kind: 'updated' | 'revoked'
    ) => {
      metrics.count(kind, release) // Attempts, not delivery acknowledgements.
      try {
        if (
          client.emit('app:' + application.appName + ':update', data) === false
        ) {
          metrics.count('emitErrors', release)
          return false
        }
        return true
      } catch {
        metrics.count('emitErrors', release)
        return false
      }
    }

    if (previous && (!payload || previousId !== nextId)) {
      if (!emit(previous, { ...previous.payload, enabled: false }, 'revoked')) {
        if (payload) metrics.skip('revoke_emit_failed')
        return
      }
      socketDeliveries.delete(application.appName)
    }
    if (payload && decision.release) {
      if (force || previousId !== nextId) {
        if (emit(decision.release, payload, 'updated')) {
          socketDeliveries.set(application.appName, {
            payload,
            releaseId: decision.release.releaseId,
            releaseSequence: decision.release.releaseSequence
          })
        }
      } else metrics.skip('unchanged')
    }
    if (socketDeliveries.size) {
      this.deliveredReleases.set(subscriber.socketId, socketDeliveries)
    } else {
      this.deliveredReleases.delete(subscriber.socketId)
    }
  }
}
