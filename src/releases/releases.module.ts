import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { WsModule } from '@/ws'
import { ReleaseManagementController } from './release-management.controller'
import { ReleaseManagementService } from './release-management.service'
import { ReleaseDraftService } from './release-draft.service'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { otaUploadMaxBytes } from '@/api/version/upload-policy'

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
  controllers: [ReleaseManagementController],
  providers: [ReleaseManagementService, ReleaseDraftService]
})
export class ReleasesModule {}
