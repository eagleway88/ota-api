import { Module } from '@nestjs/common'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'
import { VersionController } from './version.controller'
import { VersionCheckService } from './version-check.service'
import { OtaVersionQueryService } from './ota-version-query.service'

@Module({
  imports: [ReleaseCatalogModule],
  controllers: [VersionController],
  providers: [VersionCheckService, OtaVersionQueryService]
})
export class VersionModule {}
