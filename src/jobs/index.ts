import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ApplicationsModule } from '@/applications/applications.module'
import { RealtimeModule } from '@/realtime'
import { PublishTaskWorkerService } from '@/jobs/publish/publish-task-worker.service'

@Module({
  imports: [ConfigModule, ApplicationsModule, RealtimeModule],
  providers: [PublishTaskWorkerService],
  exports: [PublishTaskWorkerService]
})
export class JobsModule {}
