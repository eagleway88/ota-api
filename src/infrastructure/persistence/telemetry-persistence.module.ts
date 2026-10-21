import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { TelemetryWriteRepository } from '@/telemetry/ports/telemetry-write.repository'
import { DualWriteTelemetryRepository } from '@/compat/legacy/persistence/dual-write-telemetry.repository'

@Module({
  imports: [ApplicationsModule],
  providers: [
    DualWriteTelemetryRepository,
    {
      provide: TelemetryWriteRepository,
      useExisting: DualWriteTelemetryRepository
    }
  ],
  exports: [TelemetryWriteRepository]
})
export class TelemetryPersistenceModule {}
