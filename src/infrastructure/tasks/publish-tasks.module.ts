import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ApplicationsModule } from '@/applications/applications.module'
import { WsModule } from '@/ws'
import { PublishTaskWorkerService } from './publish-task-worker.service'
import { RetentionService } from './retention.service'

@Module({
  imports: [ConfigModule, ApplicationsModule, WsModule],
  providers: [PublishTaskWorkerService, RetentionService],
  exports: [PublishTaskWorkerService]
})
export class PublishTasksModule {}
