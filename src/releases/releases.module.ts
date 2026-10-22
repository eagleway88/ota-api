import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleaseManagementService } from './release-management.service'
import { ReleaseDraftService } from './release-draft.service'
import { JobsModule } from '@/jobs'
import { ArtifactsModule } from '@/infrastructure/oss/artifacts.module'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'
import { ReleasePersistenceModule } from '@/infrastructure/persistence/release-persistence.module'

@Module({
  imports: [
    ApplicationsModule,
    ReleasePersistenceModule,
    ReleaseCatalogModule,
    ArtifactsModule,
    JobsModule
  ],
  providers: [ReleaseManagementService, ReleaseDraftService],
  exports: [ReleaseManagementService, ReleaseDraftService]
})
export class ReleasesModule {}
