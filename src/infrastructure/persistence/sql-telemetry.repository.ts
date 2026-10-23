import {
  BadRequestException,
  ConflictException,
  Injectable
} from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { createHash } from 'crypto'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'
import {
  ApplicationErrorInput,
  FailureReportInput,
  ReportRecord,
  ReportWriteContext,
  StatusReportInput,
  TelemetryWriteRepository
} from '@/telemetry/ports/telemetry-write.repository'
import {
  createAppErrorLogTable,
  createErrorTable,
  createSuccessTable
} from '@/infrastructure/persistence/application-schema'
import {
  applicationErrorHash,
  applicationErrorIdentity,
  applicationErrorValues,
  clientReportValues,
  failureUpdateValues,
  sameStatusContent,
  statusReportValues,
  storedReport
} from '@/infrastructure/persistence/telemetry-write.mapper'

type ReportKind = 'success' | 'error' | 'errorLog'

@Injectable()
export class SqlTelemetryRepository extends TelemetryWriteRepository {
  constructor(
    @InjectDataSource() private readonly source: DataSource,
    private readonly applications: ApplicationRegistryService
  ) {
    super()
  }

  success(input: StatusReportInput, context: ReportWriteContext) {
    return this.status('success', input, context)
  }

  failure(input: FailureReportInput, context: ReportWriteContext) {
    return this.status('error', input, context, input.message, input.recordId)
  }

  applicationError(input: ApplicationErrorInput, context: ReportWriteContext) {
    const errorHash = applicationErrorHash(input)
    return this.write(
      input.appName,
      'errorLog',
      () => `ota_app_error_${errorHash.slice(0, 40)}`,
      async (runner, app, table) => {
        const rows = await runner.manager
          .createQueryBuilder()
          .select('*')
          .addSelect('CAST(report.extras AS CHAR)', 'extras_json')
          .from(table, 'report')
          .setLock('pessimistic_write')
          .where('report.error_hash = :errorHash', { errorHash })
          .limit(2)
          .getRawMany<Record<string, unknown>>()
        if (rows.length > 1)
          throw new ConflictException('Duplicate error groups')
        const existing = rows[0]
        if (!existing)
          return this.insert(
            runner,
            table,
            applicationErrorValues(input, context)
          )
        const record = storedReport(existing)
        if (
          JSON.stringify(
            applicationErrorIdentity({
              ...record,
              kind: record.kind ?? '',
              message: record.message ?? ''
            })
          ) !== JSON.stringify(applicationErrorIdentity(input))
        )
          throw new ConflictException(
            'Error fingerprint conflicts with another report'
          )
        if (
          !Number.isSafeInteger(record.reportCount) ||
          (record.reportCount ?? 0) < 1
        )
          throw new ConflictException('Invalid error count')
        // One update: details, timestamps and count cannot commit independently.
        const mutable = clientReportValues(input)
        await runner.manager
          .createQueryBuilder()
          .update(table)
          .set({
            source_ip: mutable.source_ip,
            extras: mutable.extras,
            reported_username: mutable.reported_username,
            updated_at: context.receivedAt,
            report_count: () => 'report_count + 1'
          })
          .where('id = :id AND app_name = :appName', {
            id: record.id,
            appName: app.appName
          })
          .execute()
        return this.readInserted(runner, table, record.id)
      }
    )
  }

  private status(
    kind: 'success' | 'error',
    input: StatusReportInput,
    context: ReportWriteContext,
    message?: string,
    recordId?: number
  ) {
    return this.write(
      input.appName,
      kind,
      app =>
        input.reportId
          ? `ota_report_${createHash('sha256').update(`${app.tables[kind]}|${input.reportId.toLowerCase()}`).digest('hex').slice(0, 40)}`
          : undefined,
      async (runner, app, table) => {
        await this.requireRelease(runner, app, input.releaseSequence)
        if (recordId !== undefined) {
          const existing = await runner.manager
            .createQueryBuilder()
            .select('*')
            .addSelect('CAST(report.extras AS CHAR)', 'extras_json')
            .from(table, 'report')
            .setLock('pessimistic_write')
            .where('report.id = :recordId AND report.app_name = :appName', {
              recordId,
              appName: app.appName
            })
            .getRawOne<Record<string, unknown>>()
          if (!existing)
            throw new BadRequestException('Error record does not exist')
          this.requireReportRelease(existing, input.releaseSequence)
          const record = storedReport(existing)
          if (record.reportId) {
            if (
              (input.reportId &&
                input.reportId.toLowerCase() !==
                  record.reportId.toLowerCase()) ||
              !sameStatusContent(record, input, message)
            )
              throw new ConflictException(
                'A reportId-bound report is immutable; use a new reportId for a new event'
              )
            return record
          }
          if (input.reportId)
            throw new ConflictException(
              'Cannot attach reportId to an existing report'
            )
          await runner.manager
            .createQueryBuilder()
            .update(table)
            .set(failureUpdateValues({ ...input, message: message! }, context))
            .where('id = :recordId AND app_name = :appName', {
              recordId,
              appName: app.appName
            })
            .execute()
          return this.readInserted(runner, table, recordId)
        }
        if (input.reportId) {
          const rows = await runner.manager
            .createQueryBuilder()
            .select('*')
            .addSelect('CAST(report.extras AS CHAR)', 'extras_json')
            .from(table, 'report')
            .setLock('pessimistic_write')
            .where('LOWER(report.report_id) = :reportId', {
              reportId: input.reportId.toLowerCase()
            })
            .limit(2)
            .getRawMany<Record<string, unknown>>()
          if (rows.length > 1) throw new ConflictException('Duplicate reportId')
          if (rows[0]) {
            this.requireReportRelease(rows[0], input.releaseSequence)
            const record = storedReport(rows[0])
            if (!sameStatusContent(record, input, message))
              throw new ConflictException(
                'reportId was already used with different content'
              )
            return record
          }
        }
        return this.insert(
          runner,
          table,
          statusReportValues(input, context, message)
        )
      }
    )
  }

  private requireReportRelease(row: Record<string, unknown>, sequence: number) {
    if (Number(row.release_sequence) !== sequence)
      throw new ConflictException(
        'Report belongs to another release or has invalid linkage'
      )
  }

  private async requireRelease(
    runner: QueryRunner,
    app: RegisteredApplication,
    sequence: number
  ) {
    if (!(await runner.hasTable(app.tables.release)))
      throw new BadRequestException('Release does not exist')
    const release = await runner.manager
      .createQueryBuilder()
      .select('release.release_sequence', 'releaseSequence')
      .from(app.tables.release, 'release')
      .setLock('pessimistic_read')
      .where(
        'release.release_sequence = :sequence AND release.app_name = :appName',
        {
          sequence,
          appName: app.appName
        }
      )
      .getRawOne<{ releaseSequence: number | string }>()
    if (!release) throw new BadRequestException('Release does not exist')
  }

  private async insert(
    runner: QueryRunner,
    table: string,
    values: Record<string, unknown>
  ) {
    const result = await runner.manager
      .createQueryBuilder()
      .insert()
      .into(table)
      .values(values)
      .execute()
    const raw: unknown = result.raw
    const id = Number(
      raw && typeof raw === 'object' && 'insertId' in raw
        ? raw.insertId
        : undefined
    )
    if (!Number.isSafeInteger(id) || id < 1)
      throw new Error('Report insert did not return an ID')
    return this.readInserted(runner, table, id)
  }

  private async readInserted(
    runner: QueryRunner,
    table: string,
    id: number
  ): Promise<ReportRecord> {
    const row = await runner.manager
      .createQueryBuilder()
      .select('*')
      .addSelect('CAST(report.extras AS CHAR)', 'extras_json')
      .from(table, 'report')
      .where('report.id = :id', { id })
      .getRawOne<Record<string, unknown>>()
    if (!row) throw new Error('Report was not persisted')
    return storedReport(row)
  }

  private async write(
    appName: string,
    kind: ReportKind,
    lock: (app: RegisteredApplication) => string | undefined,
    operation: (
      runner: QueryRunner,
      app: RegisteredApplication,
      table: string
    ) => Promise<ReportRecord>
  ) {
    const runner = this.source.createQueryRunner()
    let lockName: string | undefined
    let acquired = false
    try {
      await runner.connect()
      const app = await this.applications.resolveSnapshot(appName, runner)
      if (app.status !== 'ready' || app.schemaVersion < 1)
        throw new ConflictException('Application schema is not ready')
      lockName = lock(app)
      if (lockName) {
        const rows = (await runner.query('SELECT GET_LOCK(?, 10) AS acquired', [
          lockName
        ])) as Array<{ acquired: number | string }>
        acquired = Number(rows[0]?.acquired) === 1
        if (!acquired) throw new ConflictException('Report aggregation is busy')
      }
      // Per-key advisory locks protect absent report/group rows; READ COMMITTED
      // avoids gap-lock deadlocks between unrelated keys sharing an index gap.
      await runner.startTransaction('READ COMMITTED')
      const current = await runner.manager
        .createQueryBuilder()
        .select('*')
        .from('ota_applications', 'app')
        .setLock('pessimistic_read')
        .where('app.app_name = :appName', { appName })
        .getRawOne<Record<string, unknown>>()
      if (
        current?.status !== 'ready' ||
        current.table_prefix !== app.tablePrefix ||
        Number(current.schema_version) < 1
      )
        throw new ConflictException(
          'Application schema changed; retry after preparation'
        )
      const table = app.tables[kind]
      const actual = await runner.getTable(table)
      const expected = {
        success: createSuccessTable,
        error: createErrorTable,
        errorLog: createAppErrorLogTable
      }[kind]({ tablePrefix: app.tablePrefix })
      if (
        !actual ||
        expected.columns.some(column => !actual.findColumnByName(column.name))
      )
        throw new ConflictException(
          'Application telemetry schema is incomplete; prepare the application first'
        )
      const result = await operation(runner, app, table)
      await runner.commitTransaction()
      return result
    } finally {
      try {
        if (runner.isTransactionActive) await runner.rollbackTransaction()
      } finally {
        try {
          if (acquired && lockName)
            await runner.query('SELECT RELEASE_LOCK(?)', [lockName])
        } finally {
          await runner.release()
        }
      }
    }
  }
}
