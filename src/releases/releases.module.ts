import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { WsModule } from '@/ws'
import { ReleaseManagementController } from './release-management.controller'
import { ReleaseManagementService } from './release-management.service'
import { ReleaseDraftService } from './release-draft.service'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { otaUploadMaxBytes } from '@/api/version/upload-policy'
import { RetentionService } from '@/infrastructure/tasks/retention.service'
import { AdminAuditController } from '@/admin/admin-audit.controller'
import { AdminAuditService } from '@/admin/admin-audit.service'

@Module({
  imports: [
    ApplicationsModule,
    WsModule,
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
  controllers: [ReleaseManagementController, AdminAuditController],
  providers: [
    ReleaseManagementService,
    ReleaseDraftService,
    RetentionService,
    AdminAuditService
  ],
  exports: [ReleaseManagementService]
})
export class ReleasesModule {}
