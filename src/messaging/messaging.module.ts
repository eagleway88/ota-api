import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { ApplicationMessage } from '@/entities/application-message.entity'
import { LastMessageService } from './last-message.service'

@Module({
  imports: [TypeOrmModule.forFeature([ApplicationMessage])],
  providers: [LastMessageService],
  exports: [LastMessageService]
})
export class MessagingModule {}
