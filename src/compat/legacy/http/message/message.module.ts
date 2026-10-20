import { Module } from '@nestjs/common'
import { MessageController } from './message.controller'
import { MessageService } from './message.service'
import { WsModule } from '@/ws'
import { ConfigModule } from '@nestjs/config'
import { MessagingModule } from '@/messaging/messaging.module'

@Module({
  imports: [WsModule, ConfigModule, MessagingModule],
  controllers: [MessageController],
  providers: [MessageService]
})
export class MessageModule {}
