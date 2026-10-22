import { Module } from '@nestjs/common'
import { TelemetryPersistenceModule } from '@/infrastructure/persistence/telemetry-persistence.module'
import { TelemetryWriteService } from './telemetry-write.service'
import { TelemetryWriteController } from './telemetry-write.controller'

@Module({
  imports: [TelemetryPersistenceModule],
  controllers: [TelemetryWriteController],
  providers: [TelemetryWriteService],
  exports: [TelemetryWriteService]
})
export class TelemetryWritesModule {}
