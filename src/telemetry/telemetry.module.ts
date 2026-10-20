import { Module } from '@nestjs/common'
import { AuthModule } from '@/auth/auth.module'
import { AdminQueriesModule } from '@/infrastructure/persistence/admin-queries.module'
import { TelemetryController } from './telemetry.controller'
import { TelemetryQueryService } from './telemetry-query.service'

@Module({
  imports: [AuthModule, AdminQueriesModule],
  controllers: [TelemetryController],
  providers: [TelemetryQueryService]
})
export class TelemetryModule {}
