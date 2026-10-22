import { Module } from '@nestjs/common'
import { LegacyUpdateCheckModule } from '@/compat/legacy/update-check.module'

/**
 * Only the legacy update check has a backwards-compatibility guarantee.
 */
@Module({
  imports: [LegacyUpdateCheckModule]
})
export class LegacyCompatibilityModule {}
