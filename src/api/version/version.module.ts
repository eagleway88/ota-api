import { Module } from '@nestjs/common'
import { MulterModule } from '@nestjs/platform-express'
import { VersionController } from '.'
import { OtaVersionQueryService } from './ota-version-query.service'
import { VersionService } from './version.service'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { WsModule } from '@/ws'
import { otaUploadMaxBytes } from './upload-policy'

@Module({
  imports: [
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
  controllers: [VersionController],
  providers: [VersionService, OtaVersionQueryService]
})
export class VersionModule {}
