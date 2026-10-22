import { Injectable } from '@nestjs/common'
import { QueryRunner } from 'typeorm'
import { RegisteredApplication } from '@/applications/application-registry.service'
import {
  ReleaseWriteInput,
  ReleaseWriteRepository
} from '@/releases/ports/release-write.repository'
import { underlineToHump } from '@/utils'
import {
  dualWriteReleaseValues,
  enabledWriteValues,
  legacyReleaseWriteValues
} from '@/infrastructure/persistence/legacy/release-write.mapper'

@Injectable()
export class DualWriteReleaseRepository extends ReleaseWriteRepository {
  async insert(
    runner: QueryRunner,
    application: RegisteredApplication,
    input: ReleaseWriteInput
  ) {
    const stored = await this.insertRecord(
      runner,
      application,
      dualWriteReleaseValues(input)
    )
    return { releaseId: input.releaseId, releaseSequence: Number(stored.id) }
  }

  async insertLegacy(
    runner: QueryRunner,
    application: RegisteredApplication,
    payload: Record<string, unknown>
  ) {
    const stored = await this.insertRecord(
      runner,
      application,
      legacyReleaseWriteValues(payload)
    )
    return underlineToHump(stored) as Record<string, unknown>
  }

  async setEnabled(
    runner: QueryRunner,
    application: RegisteredApplication,
    releaseId: string,
    enabled: boolean
  ) {
    this.assertTransaction(runner)
    await runner.manager
      .createQueryBuilder()
      .update(application.tables.version)
      .set(enabledWriteValues(enabled))
      .where('release_id = :releaseId AND name = :appName', {
        releaseId,
        appName: application.appName
      })
      .execute()
  }

  private async insertRecord(
    runner: QueryRunner,
    application: RegisteredApplication,
    values: Record<string, unknown>
  ) {
    this.assertTransaction(runner)
    if (values.name !== application.appName)
      throw new Error(
        'Publication application does not match its registered table'
      )
    await runner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.version)
      .values(values)
      .execute()
    const stored = await runner.manager
      .createQueryBuilder()
      .select('*')
      .from(application.tables.version, 'release')
      .where('release.release_id = :releaseId AND release.name = :appName', {
        releaseId: values.release_id,
        appName: application.appName
      })
      .getRawOne<Record<string, unknown>>()
    if (
      !stored ||
      !Number.isSafeInteger(Number(stored.id)) ||
      Number(stored.id) < 1
    )
      throw new Error('Release sequence allocation failed')
    return stored
  }

  private assertTransaction(runner: QueryRunner) {
    if (!runner.isTransactionActive)
      throw new Error(
        'Release writes require an application-locked transaction'
      )
  }
}
