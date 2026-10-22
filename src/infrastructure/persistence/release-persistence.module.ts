import { Module } from '@nestjs/common'
import { ReleaseWriteRepository } from '@/releases/ports/release-write.repository'
import { SqlReleaseRepository } from '@/infrastructure/persistence/sql-release.repository'

/** Composition boundary: formal services depend on the port, only formal storage. */
@Module({
  providers: [
    SqlReleaseRepository,
    { provide: ReleaseWriteRepository, useExisting: SqlReleaseRepository }
  ],
  exports: [ReleaseWriteRepository, SqlReleaseRepository]
})
export class ReleasePersistenceModule {}
