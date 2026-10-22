import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { TelemetryController } from '@/manage/statistics/statistics.controller'
import { TelemetryQueryService } from '@/manage/statistics/statistics.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [TelemetryController],
  providers: [TelemetryQueryService]
})
export class TelemetryModule {}
