import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AuditModule } from '@/manage/audit/audit.module'
import { TaskQueriesModule } from '@/manage/tasks/tasks.module'
import { TelemetryModule } from '@/manage/statistics/statistics.module'

/** Administrator read APIs are assembled independently of legacy endpoints. */
@Module({
  imports: [AuthModule, AuditModule, TaskQueriesModule, TelemetryModule]
})
export class AdministrationModule {}
