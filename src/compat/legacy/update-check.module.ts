import { Module } from '@nestjs/common'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'
import { LegacyUpdateCheckController } from '@/compat/legacy/update-check.controller'
import { LegacyUpdateCheckService } from '@/compat/legacy/update-check.service'
import { UpdateQueryService } from '@/updates/update-query.service'

@Module({
  imports: [ReleaseCatalogModule],
  controllers: [LegacyUpdateCheckController],
  providers: [LegacyUpdateCheckService, UpdateQueryService]
})
export class LegacyUpdateCheckModule {}
