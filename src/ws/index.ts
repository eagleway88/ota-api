import { Module } from '@nestjs/common'
import { OtaVersionQueryService } from '@/compat/legacy/http/version/ota-version-query.service'
import { WsService } from './ws.service'
import { MessagingModule } from '@/messaging/messaging.module'
import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'

@Module({
  imports: [MessagingModule, ApplicationsModule, ReleaseCatalogModule],
  providers: [WsService, OtaVersionQueryService, ConnectionSubscriptionStore],
  exports: [WsService, OtaVersionQueryService]
})
export class WsModule {}
