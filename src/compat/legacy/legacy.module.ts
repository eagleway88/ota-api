import { Module } from '@nestjs/common'
import { AdminModule } from '@/api/admin/admin.module'
import { MessageModule } from '@/api/message/message.module'
import { VersionModule } from '@/api/version/version.module'

/**
 * Single assembly boundary for every endpoint retained for the legacy SDK.
 * Formal v2 modules must be registered independently of this module.
 */
@Module({
  imports: [AdminModule, MessageModule, VersionModule]
})
export class LegacyCompatibilityModule {}
