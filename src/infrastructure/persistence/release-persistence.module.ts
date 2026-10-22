import { Module } from '@nestjs/common'
import { ReleaseWriteRepository } from '@/releases/ports/release-write.repository'
import { DualWriteReleaseRepository } from '@/infrastructure/persistence/legacy/dual-write-release.repository'

/** Composition boundary: formal services depend on the port, not legacy columns. */
@Module({
  providers: [
    DualWriteReleaseRepository,
    { provide: ReleaseWriteRepository, useExisting: DualWriteReleaseRepository }
  ],
  exports: [ReleaseWriteRepository, DualWriteReleaseRepository]
})
export class ReleasePersistenceModule {}
