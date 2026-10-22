import { UpdateCheckController } from './updates/update-check.controller'
import { UpdateCheckService } from './updates/update-check.service'
import { ReleaseCatalogModule } from '@/updates/catalog/release-catalog.module'
import { UpdateQueryService } from '@/updates/update-query.service'
import { Module } from '@nestjs/common'
import { TelemetryWritesModule } from '@/telemetry/telemetry-writes.module'
import { TelemetryWriteController } from './telemetry/telemetry.controller'

@Module({
  imports: [TelemetryWritesModule, ReleaseCatalogModule],
  controllers: [TelemetryWriteController, UpdateCheckController],
  providers: [UpdateCheckService, UpdateQueryService]
})
export class AppApiModule {}
