import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { TaskQueryController } from '@/manage/tasks/tasks.controller'
import { TaskQueryService } from '@/manage/tasks/tasks.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [TaskQueryController],
  providers: [TaskQueryService]
})
export class TaskQueriesModule {}
