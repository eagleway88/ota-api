import { ConflictException, Logger } from '@nestjs/common'
import { DataSource, QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import { applicationPreparationLock } from './application-lock'

export type ApplicationWriteState = {
  outcome:
    | 'not_started'
    | 'writing'
    | 'committing'
    | 'committed'
    | 'rolled_back'
    | 'unknown'
}

const logger = new Logger('ApplicationWriteTransaction')

/** Acquire before touching any release/draft row; hold until commit/rollback. */
export async function withApplicationWrite<T>(
  source: DataSource,
  application: RegisteredApplication,
  write: (runner: QueryRunner) => Promise<T>,
  state: ApplicationWriteState = { outcome: 'not_started' }
): Promise<T> {
  const runner = source.createQueryRunner()
  const lockName = applicationPreparationLock(application.appName)
  let locked = false
  let failure: { error: unknown } | undefined
  let result!: T
  let commitAttempted = false
  state.outcome = 'not_started'
  try {
    await runner.connect()
    const lock = (await runner.query('SELECT GET_LOCK(?, 30) AS acquired', [
      lockName
    ])) as Array<{ acquired: number | string }>
    locked = Number(lock[0]?.acquired) === 1
    if (!locked) throw new ConflictException('Application write is busy')
    state.outcome = 'unknown'
    await runner.startTransaction()
    state.outcome = 'writing'
    // prepare() can have returned before another process changed the application status.
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
        'Application is not ready or its mapping changed; prepare the application first'
      )
    result = await write(runner)
    commitAttempted = true
    state.outcome = 'committing'
    await runner.commitTransaction()
    state.outcome = 'committed'
  } catch (error) {
    failure = { error }
    if (runner.isTransactionActive) {
      try {
        await runner.rollbackTransaction()
        // A lost COMMIT acknowledgement cannot be resolved by a later ROLLBACK.
        state.outcome = commitAttempted ? 'unknown' : 'rolled_back'
      } catch {
        state.outcome = 'unknown'
      }
    }
    if (commitAttempted) state.outcome = 'unknown'
  } finally {
    let cleanupFailure: { error: unknown } | undefined
    try {
      if (locked) await runner.query('SELECT RELEASE_LOCK(?)', [lockName])
    } catch (error) {
      cleanupFailure = { error }
    }
    try {
      await runner.release()
    } catch (error) {
      cleanupFailure ??= { error }
    }
    if (cleanupFailure) {
      logger.error({
        event: 'application_write_cleanup_failed',
        appName: application.appName,
        outcome: state.outcome
      })
      failure ??= cleanupFailure
    }
  }
  if (failure) throw failure.error
  return result
}
