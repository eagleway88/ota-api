import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'
import { LastMessageService } from './last-message.service'

@Module({
  imports: [TypeOrmModule.forFeature([UserIdMessage, UniqueIdMessage])],
  providers: [LastMessageService],
  exports: [LastMessageService]
})
export class MessagingModule {}
