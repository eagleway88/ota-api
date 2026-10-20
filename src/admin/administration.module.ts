import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AuditModule } from '@/audit/audit.module'
import { TaskQueriesModule } from '@/infrastructure/tasks/task-queries.module'
import { TelemetryModule } from '@/telemetry/telemetry.module'

/** Administrator read APIs are assembled independently of legacy endpoints. */
@Module({
  imports: [AuthModule, AuditModule, TaskQueriesModule, TelemetryModule]
})
export class AdministrationModule {}
