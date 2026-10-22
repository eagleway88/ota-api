import { ForbiddenException, Injectable } from '@nestjs/common'
import { apiUtil } from '@/utils/api'
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import {
  SendMessageDto,
  TargetedMessageEnvelope
} from '@/manage/messages/messages.dto'
import { SendUserIdDto, SendUniqueIdDto } from '@/manage/messages/messages.dto'
import { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { isRequestIpAllowed } from '@/utils'
import { LastMessageService } from '@/messaging/last-message.service'
import { parseUserId } from '@/contracts/user-id'

@Injectable()
export class MessageService {
  constructor(
    private readonly wsService: RealtimeGateway,
    private readonly configService: ConfigService,
    private readonly lastMessageService: LastMessageService
  ) {}

  private checkPermission(req: Request) {
    const ips = this.configService.get<string>('IPS')
    return isRequestIpAllowed(req, ips)
  }

  private getResendTtlMs() {
    // 过期时间 默认是 86400 秒，也就是 24 小时
    const ttlSeconds = Number(
      this.configService.get('MESSAGE_RESEND_TTL_SECONDS') ?? 86400
    )
    return Math.max(ttlSeconds, 1) * 1000
  }

  private createTransientEnvelope(data: unknown): TargetedMessageEnvelope {
    return {
      messageId: null,
      data,
      updatedAt: new Date().toISOString(),
      expiresAt: null,
      ackRequired: false
    }
  }

  async listSubscribedUserIds(req: Request, name?: string) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    return apiUtil.data(await this.wsService.getSubscribedUserIds(name))
  }

  async sendApplication(req: Request, appName: string, body: SendMessageDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    const bool = await this.wsService.sendApplicationMessage(appName, body.data)
    return bool ? apiUtil.data(appName) : apiUtil.error('Send failed')
  }

  async sendUserId(req: Request, appName: string, body: SendUserIdDto) {
    if (parseUserId(body.userId)?.appName !== appName)
      throw new ForbiddenException(
        'User target belongs to a different application'
      )
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    const payload = body.resend
      ? await this.lastMessageService.createUserId(body, this.getResendTtlMs())
      : this.createTransientEnvelope(body.data)

    const bool = await this.wsService.sendUserIdMessage(body.userId, payload)
    return bool
      ? apiUtil.data({ userId: body.userId, ...payload })
      : apiUtil.error('Send failed')
  }

  async sendUniqueId(req: Request, appName: string, body: SendUniqueIdDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    const payload = body.resend
      ? await this.lastMessageService.createUniqueId(
          { ...body, appName },
          this.getResendTtlMs()
        )
      : this.createTransientEnvelope(body.data)

    const bool = await this.wsService.sendUniqueIdMessage(
      appName,
      body.uniqueId,
      payload
    )
    return bool
      ? apiUtil.data({ uniqueId: body.uniqueId, ...payload })
      : apiUtil.error('Send failed')
  }
}
