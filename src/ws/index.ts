import { Module } from '@nestjs/common'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { WsService } from './ws.service'
import { LastMessageService } from '@/api/message/last-message.service'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'

@Module({
  imports: [TypeOrmModule.forFeature([UserIdMessage, UniqueIdMessage])],
  providers: [WsService, OtaVersionQueryService, LastMessageService],
  exports: [WsService]
})
export class WsModule { }
