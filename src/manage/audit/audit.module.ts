import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { AuditController } from '@/manage/audit/audit.controller'
import { AuditQueryService } from '@/manage/audit/audit.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [AuditController],
  providers: [AuditQueryService]
})
export class AuditModule {}
