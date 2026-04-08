import { Module } from '@nestjs/common'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { WsService } from './ws.service'
import { LastMessageService } from '@/api/message/last-message.service'

@Module({
  imports: [],
  providers: [WsService, OtaVersionQueryService, LastMessageService],
  exports: [WsService]
})
export class WsModule { }
