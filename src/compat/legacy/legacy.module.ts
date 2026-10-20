import { Module } from '@nestjs/common'
import { AdminModule } from '@/compat/legacy/http/admin/admin.module'
import { MessageModule } from '@/compat/legacy/http/message/message.module'
import { VersionModule } from '@/compat/legacy/http/version/version.module'

/**
 * Single assembly boundary for every endpoint retained for the legacy SDK.
 * Formal v2 modules must be registered independently of this module.
 */
@Module({
  imports: [AdminModule, MessageModule, VersionModule]
})
export class LegacyCompatibilityModule {}
