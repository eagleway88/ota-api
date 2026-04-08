import { Module } from '@nestjs/common'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { WsService } from './ws.service'

@Module({
  imports: [],
  providers: [WsService, OtaVersionQueryService],
  exports: [WsService]
})
export class WsModule { }
