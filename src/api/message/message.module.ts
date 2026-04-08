
import { Module } from '@nestjs/common'
import { MessageController } from '.'
import { MessageService } from './message.service'
import { WsModule } from '@/ws'
import { ConfigModule } from '@nestjs/config'

@Module({
  imports: [WsModule, ConfigModule],
  controllers: [MessageController],
  providers: [MessageService]
})
export class MessageModule { }
