import { Module } from '@nestjs/common'
import { MessageController } from '@/manage/messages/messages.controller'
import { MessageService } from '@/manage/messages/messages.service'
import { RealtimeModule } from '@/realtime'
import { ConfigModule } from '@nestjs/config'
import { MessagingModule } from '@/messaging/messaging.module'

@Module({
  imports: [RealtimeModule, ConfigModule, MessagingModule],
  controllers: [MessageController],
  providers: [MessageService]
})
export class MessageModule {}
