import { ConflictException } from '@nestjs/common'
import { DataSource, QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import { applicationPreparationLock } from './application-lock'

/** Acquire before touching any release/draft row; hold until commit/rollback. */
export async function withApplicationWrite<T>(
  source: DataSource,
  application: RegisteredApplication,
  write: (runner: QueryRunner) => Promise<T>
): Promise<T> {
  const runner = source.createQueryRunner()
  const lockName = applicationPreparationLock(application.appName)
  let locked = false
  try {
    await runner.connect()
    const lock = (await runner.query('SELECT GET_LOCK(?, 30) AS acquired', [
      lockName
    ])) as Array<{ acquired: number | string }>
    locked = Number(lock[0]?.acquired) === 1
    if (!locked)
      throw new ConflictException('Application write or migration is busy')
    await runner.startTransaction()
    // prepare() can have returned before another process paused the application.
    const records = (await runner.query(
      'SELECT table_prefix, status, schema_version FROM ota_applications WHERE app_name = ? FOR UPDATE',
      [application.appName]
    )) as Array<{
      table_prefix: string
      status: string
      schema_version: number | string
    }>
    const current = records[0]
    if (
      !current ||
      current.status !== 'ready' ||
      Number(current.schema_version) < 1 ||
      current.table_prefix !== application.tablePrefix
    )
      throw new ConflictException(
        'Application is not ready or its mapping changed; prepare/resume migration first'
      )
    const result = await write(runner)
    await runner.commitTransaction()
    return result
  } catch (error) {
    if (runner.isTransactionActive) await runner.rollbackTransaction()
    throw error
  } finally {
    try {
      if (locked) await runner.query('SELECT RELEASE_LOCK(?)', [lockName])
    } finally {
      await runner.release()
    }
  }
}
