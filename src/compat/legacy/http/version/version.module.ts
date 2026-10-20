import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { VersionController } from './version.controller'
import { VersionService } from './version.service'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { WsModule } from '@/ws'
import { otaUploadMaxBytes } from '@/artifacts/upload-policy'
import { ApplicationsModule } from '@/applications/applications.module'
import { ReleasesModule } from '@/releases/releases.module'

@Module({
  imports: [
    WsModule,
    ApplicationsModule,
    ReleasesModule,
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
  controllers: [VersionController],
  providers: [VersionService]
})
export class VersionModule {}
