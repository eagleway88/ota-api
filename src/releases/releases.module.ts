import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleaseManagementController } from './release-management.controller'
import { ReleaseManagementService } from './release-management.service'
import { ReleaseDraftService } from './release-draft.service'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { otaUploadMaxBytes } from '@/artifacts/upload-policy'
import { PublishTasksModule } from '@/infrastructure/tasks/publish-tasks.module'
import { ArtifactsModule } from '@/artifacts/artifacts.module'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'

@Module({
  imports: [
    ApplicationsModule,
    ReleaseCatalogModule,
    ArtifactsModule,
    PublishTasksModule,
    ConfigModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        limits: {
          fileSize: otaUploadMaxBytes(configService.get('OTA_UPLOAD_MAX_BYTES'))
        }
      })
    })
  ],
  controllers: [ReleaseManagementController],
  providers: [ReleaseManagementService, ReleaseDraftService],
  exports: [ReleaseManagementService]
})
export class ReleasesModule {}
