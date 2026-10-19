import { Module } from '@nestjs/common'
import { OtaVersionQueryService } from '@/api/version/ota-version-query.service'
import { WsService } from './ws.service'
import { LastMessageService } from '@/api/message/last-message.service'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { ApplicationsModule } from '@/applications/applications.module'

@Module({
  imports: [
    TypeOrmModule.forFeature([UserIdMessage, UniqueIdMessage]),
    ApplicationsModule
  ],
  providers: [
    WsService,
    OtaVersionQueryService,
    LastMessageService,
    ConnectionSubscriptionStore
  ],
  exports: [WsService, OtaVersionQueryService]
})
export class WsModule {}
