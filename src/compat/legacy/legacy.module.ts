import { Module } from '@nestjs/common'
import { VersionModule } from '@/compat/legacy/http/version/version.module'

/**
 * Only the legacy update check has a backwards-compatibility guarantee.
 */
@Module({
  imports: [VersionModule]
})
export class LegacyCompatibilityModule {}
