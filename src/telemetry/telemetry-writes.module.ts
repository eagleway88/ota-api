import { Module } from '@nestjs/common'
import { TelemetryPersistenceModule } from '@/infrastructure/persistence/telemetry-persistence.module'
import { TelemetryWriteService } from './telemetry-write.service'

@Module({
  imports: [TelemetryPersistenceModule],
  providers: [TelemetryWriteService],
  exports: [TelemetryWriteService]
})
export class TelemetryWritesModule {}
