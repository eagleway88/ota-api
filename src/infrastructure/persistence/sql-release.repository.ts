import { Injectable } from '@nestjs/common'
import { QueryRunner } from 'typeorm'
import { RegisteredApplication } from '@/applications/application-registry.service'
import {
  ReleaseWriteInput,
  ReleaseWriteRepository
} from '@/releases/ports/release-write.repository'
import {
  releaseWriteValues,
  enabledWriteValues
} from '@/infrastructure/persistence/release-write.mapper'

@Injectable()
export class SqlReleaseRepository extends ReleaseWriteRepository {
  async insert(
    runner: QueryRunner,
    application: RegisteredApplication,
    input: ReleaseWriteInput
  ) {
    const stored = await this.insertRecord(
      runner,
      application,
      releaseWriteValues(input)
    )
    return {
      releaseId: input.releaseId,
      releaseSequence: Number(stored.release_sequence)
    }
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
      .update(application.tables.release)
      .set(enabledWriteValues(enabled))
      .where('release_id = :releaseId AND app_name = :appName', {
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
    if (values.app_name !== application.appName)
      throw new Error(
        'Publication application does not match its registered table'
      )
    await runner.manager
      .createQueryBuilder()
      .insert()
      .into(application.tables.release)
      .values(values)
      .execute()
    const stored = await runner.manager
      .createQueryBuilder()
      .select('*')
      .from(application.tables.release, 'release')
      .where(
        'release.release_id = :releaseId AND release.app_name = :appName',
        {
          releaseId: values.release_id,
          appName: application.appName
        }
      )
      .getRawOne<Record<string, unknown>>()
    if (
      !stored ||
      !Number.isSafeInteger(Number(stored.release_sequence)) ||
      Number(stored.release_sequence) < 1
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
