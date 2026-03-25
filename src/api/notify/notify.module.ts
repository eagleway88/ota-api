
import { Module } from '@nestjs/common'
import { NotifyController } from '.'
import { NotifyService } from './notify.service'
import { WsModule } from '@/ws'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [WsModule, ConfigModule],
  controllers: [NotifyController],
  providers: [NotifyService]
})
export class NotifyModule { }
