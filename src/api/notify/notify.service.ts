import { Injectable } from '@nestjs/common'
import { apiUtil } from '@/utils/api'
import { WsService } from '@/ws/ws.service'
import { SendDto } from './notify.dto'
import { Request } from 'express'
import { ConfigService } from '@nestjs/config'
import { fetchIP } from '@/utils'

@Injectable()
export class NotifyService {
  constructor(
    private readonly wsService: WsService,
    private readonly configService: ConfigService,
  ) { }

  async send(req: Request, body: SendDto) {
    const ip = fetchIP(req)
    const ips = this.configService.get<string>('IPS')
    if (ips && !ips.includes(ip)) {
      return apiUtil.error('Permission denied')
    }
    console.log('send', JSON.stringify(body))
    const ids = await this.wsService.sendBroadcast(body.type, body.data, body.clientId)
    if (body.clientId) {
      return ids[body.clientId] ? apiUtil.data(body.type) : apiUtil.error('Send failed')
    } else {
      return apiUtil.data(body.type)
    }
  }

  async uid(req: Request, body: SendDto) {
    const ip = fetchIP(req)
    const ips = this.configService.get<string>('IPS')
    if (ips && !ips.includes(ip)) {
      return apiUtil.error('Permission denied')
    }
    console.log('uid', JSON.stringify(body))
    const bool = await this.wsService.sendUidMessage(body.type, body.data)
    return bool ? apiUtil.data(body.type) : apiUtil.error('Send failed')
  }

}
