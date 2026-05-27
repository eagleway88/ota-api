import { Injectable } from '@nestjs/common'
import { apiUtil } from '@/utils/api'
import { WsService } from '@/ws/ws.service'
import { SendGlobalDto, SendOtaNameDto, TargetedMessageEnvelope } from './message.dto'
import { SendUserIdDto, SendUniqueIdDto } from './message.dto'
import { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { fetchIP } from '@/utils'
import { LastMessageService } from './last-message.service'

@Injectable()
export class MessageService {
  constructor(
    private readonly wsService: WsService,
    private readonly configService: ConfigService,
    private readonly lastMessageService: LastMessageService
  ) { }

  private checkPermission(req: Request) {
    const ip = fetchIP(req)
    const ips = this.configService.get<string>('IPS')
    if (ips && !ips.includes(ip)) {
      return false
    }
    return true
  }

  private getResendTtlMs() {
    // 过期时间 默认是 86400 秒，也就是 24 小时
    const ttlSeconds = Number(this.configService.get('MESSAGE_RESEND_TTL_SECONDS') ?? 86400)
    return Math.max(ttlSeconds, 1) * 1000
  }

  private createTransientEnvelope(data: any): TargetedMessageEnvelope {
    return {
      messageId: null,
      data,
      updatedAt: new Date().toISOString(),
      expiresAt: null,
      ackRequired: false
    }
  }

  async sendGlobal(req: Request, body: SendGlobalDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    await this.wsService.sendMessage(body.data)
    return apiUtil.data('success')
  }

  async sendOtaName(req: Request, body: SendOtaNameDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    const bool = await this.wsService.sendOtaNameMessage(body.otaName, body.data)
    return bool ? apiUtil.data(body.otaName) : apiUtil.error('Send failed')
  }

  async sendUserId(req: Request, body: SendUserIdDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    console.log('body.resend', body.resend)
    const payload = body.resend
      ? await this.lastMessageService.createUserId(body, this.getResendTtlMs())
      : this.createTransientEnvelope(body.data)

    const bool = await this.wsService.sendUserIdMessage(body.userId, payload)
    return bool
      ? apiUtil.data({ userId: body.userId, ...payload })
      : apiUtil.error('Send failed')
  }

  async sendUniqueId(req: Request, body: SendUniqueIdDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    const payload = body.resend
      ? await this.lastMessageService.createUniqueId(body, this.getResendTtlMs())
      : this.createTransientEnvelope(body.data)

    const bool = await this.wsService.sendUniqueIdMessage(body.uniqueId, payload)
    return bool
      ? apiUtil.data({ uniqueId: body.uniqueId, ...payload })
      : apiUtil.error('Send failed')
  }
}
