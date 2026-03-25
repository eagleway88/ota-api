
import { Module } from '@nestjs/common'
import { VersionController } from '.'
import { VersionService } from './version.service'
import { ConfigModule } from '@nestjs/config'
import { WsModule } from '@/ws'

@Module({
  imports: [WsModule, ConfigModule],
  controllers: [VersionController],
  providers: [VersionService]
})
export class VersionModule { }
