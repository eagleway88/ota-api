import { Module } from '@nestjs/common'
import { TelemetryWritesModule } from '@/telemetry/telemetry-writes.module'
import { TelemetryWriteController } from './telemetry/telemetry.controller'

@Module({
  imports: [TelemetryWritesModule],
  controllers: [TelemetryWriteController]
})
export class AppApiModule {}
