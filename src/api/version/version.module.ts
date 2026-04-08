
import { Module } from '@nestjs/common'
import { VersionController } from '.'
import { OtaVersionQueryService } from './ota-version-query.service'
import { VersionService } from './version.service'
import { ConfigModule } from '@nestjs/config'
import { WsModule } from '@/ws'

@Module({
  imports: [WsModule, ConfigModule],
  controllers: [VersionController],
  providers: [VersionService, OtaVersionQueryService]
})
export class VersionModule { }
