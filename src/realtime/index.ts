import { Module } from '@nestjs/common'
import { UpdateQueryService } from '@/updates/update-query.service'
import { RealtimeGateway } from '@/realtime/gateway/realtime.gateway'
import { MessagingModule } from '@/messaging/messaging.module'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'

@Module({
  imports: [MessagingModule, ApplicationsModule, ReleaseCatalogModule],
  providers: [RealtimeGateway, UpdateQueryService, ConnectionSubscriptionStore],
  exports: [RealtimeGateway, UpdateQueryService]
})
export class RealtimeModule {}
