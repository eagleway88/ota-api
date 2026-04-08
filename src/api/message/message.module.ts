
import { Module } from '@nestjs/common'
import { MessageController } from '.'
import { MessageService } from './message.service'
import { WsModule } from '@/ws'
import { ConfigModule } from '@nestjs/config'
import { LastMessageService } from './last-message.service'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'

@Module({
  imports: [WsModule, ConfigModule, TypeOrmModule.forFeature([UserIdMessage, UniqueIdMessage])],
  controllers: [MessageController],
  providers: [MessageService, LastMessageService]
})
export class MessageModule { }
