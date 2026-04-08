import { Injectable, Logger } from '@nestjs/common'
import { apiUtil } from '@/utils/api'
import { WsService } from '@/ws/ws.service'
import { SendGlobalDto, SendOtaNameDto } from './message.dto'
import { SendUserIdDto, SendUniqueIdDto } from './message.dto'
import { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { fetchIP } from '@/utils'
import { LastMessageService } from './last-message.service'

@Injectable()
export class MessageService {
  private readonly logger = new Logger(MessageService.name, { timestamp: true })
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

  async sendGlobal(req: Request, body: SendGlobalDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    this.logger.log('sendGlobal:', JSON.stringify(body))
    await this.wsService.sendMessage(body.type, body.data)
    return apiUtil.data(body.type)
  }

  async sendOtaName(req: Request, body: SendOtaNameDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    this.logger.log('sendOtaName:', JSON.stringify(body))
    const bool = await this.wsService.sendOtaNameMessage(body.otaName, body.data)
    return bool ? apiUtil.data(body.otaName) : apiUtil.error('Send failed')
  }

  async sendUserId(req: Request, body: SendUserIdDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    this.logger.log('sendUserId:', JSON.stringify(body))
    await this.lastMessageService.createUserId(body)
    const bool = await this.wsService.sendUserIdMessage(body.userId, body.data)
    return bool ? apiUtil.data(body.userId) : apiUtil.error('Send failed')
  }

  async sendUniqueId(req: Request, body: SendUniqueIdDto) {
    if (!this.checkPermission(req)) {
      return apiUtil.error('Permission denied')
    }
    this.logger.log('sendUniqueId:', JSON.stringify(body))
    await this.lastMessageService.createUniqueId(body)
    const bool = await this.wsService.sendUniqueIdMessage(body.uniqueId, body.data)
    return bool ? apiUtil.data(body.uniqueId) : apiUtil.error('Send failed')
  }

  async clearUserId(body: SendUserIdDto) {
    await this.lastMessageService.deleteUserId(body)
    return apiUtil.data(body.userId)
  }

  async clearUniqueId(body: SendUniqueIdDto) {
    await this.lastMessageService.deleteUniqueId(body)
    return apiUtil.data(body.uniqueId)
  }
}
