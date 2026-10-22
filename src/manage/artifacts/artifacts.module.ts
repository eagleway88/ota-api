import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { MulterModule } from '@nestjs/platform-express'
import { ArtifactsModule } from '@/infrastructure/oss/artifacts.module'
import { otaUploadMaxBytes } from '@/infrastructure/oss/upload-policy'
import { ArtifactsController } from './artifacts.controller'

@Module({
  imports: [
    ArtifactsModule,
    MulterModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        limits: {
          fileSize: otaUploadMaxBytes(config.get('OTA_UPLOAD_MAX_BYTES'))
        }
      })
    })
  ],
  controllers: [ArtifactsController]
})
export class ManageArtifactsModule {}
