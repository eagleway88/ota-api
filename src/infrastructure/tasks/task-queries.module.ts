import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { TaskQueryController } from './task-query.controller'
import { TaskQueryService } from './task-query.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [TaskQueryController],
  providers: [TaskQueryService]
})
export class TaskQueriesModule {}
