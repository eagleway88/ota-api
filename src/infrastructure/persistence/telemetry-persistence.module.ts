import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { TelemetryWriteRepository } from '@/telemetry/ports/telemetry-write.repository'
import { SqlTelemetryRepository } from '@/infrastructure/persistence/sql-telemetry.repository'

@Module({
  imports: [ApplicationsModule],
  providers: [
    SqlTelemetryRepository,
    {
      provide: TelemetryWriteRepository,
      useExisting: SqlTelemetryRepository
    }
  ],
  exports: [TelemetryWriteRepository]
})
export class TelemetryPersistenceModule {}
