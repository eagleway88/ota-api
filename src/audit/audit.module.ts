import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { AuditController } from './audit.controller'
import { AuditQueryService } from './audit-query.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [AuditController],
  providers: [AuditQueryService]
})
export class AuditModule {}
