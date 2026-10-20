import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleaseCatalogService } from './release-catalog.service'

@Module({
  imports: [ApplicationsModule],
  providers: [ReleaseCatalogService],
  exports: [ReleaseCatalogService]
})
export class ReleaseCatalogModule {}
