import { createHash } from 'crypto'
import {
  ApplicationErrorInput,
  ClientReport,
  FailureReportInput,
  JsonValue,
  ReportRecord,
  ReportWriteContext,
  StatusReportInput
} from '@/telemetry/ports/telemetry-write.repository'

export function clientReportValues(input: ClientReport) {
  return compact({
    app_name: input.appName,
    platform: input.platform,
    version_code: input.versionCode,
    reported_username: input.reportedUsername,
    extras:
      input.extras === undefined
        ? undefined
        : input.extras === null
          ? null
          : JSON.stringify(input.extras),
    source_ip: input.sourceIp
  })
}

export function statusReportValues(
  input: StatusReportInput,
  context: ReportWriteContext,
  message?: string
) {
  return compact({
    ...clientReportValues(input),
    release_sequence: input.releaseSequence,
    report_id: input.reportId?.toLowerCase(),
    created_at: context.receivedAt,
    ...(message === undefined
      ? {}
      : {
          message,
          updated_at: context.receivedAt
        })
  })
}

export function failureUpdateValues(
  input: FailureReportInput,
  context: ReportWriteContext
) {
  return {
    ...clientReportValues(input),
    release_sequence: input.releaseSequence,
    message: input.message,
    updated_at: context.receivedAt
  }
}

export function applicationErrorValues(
  input: ApplicationErrorInput,
  context: ReportWriteContext
) {
  return compact({
    ...clientReportValues(input),
    kind: input.kind,
    message: input.message,
    stack: input.stack,
    error_hash: applicationErrorHash(input),
    report_count: 1,
    created_at: context.receivedAt,
    updated_at: context.receivedAt
  })
}

export function applicationErrorIdentity(input: ApplicationErrorInput) {
  return [
    input.appName,
    input.platform,
    String(input.versionCode),
    input.kind,
    input.message,
    input.stack ?? ''
  ].map(value => value.replace(/\r\n/g, '\n').trim())
}

/** Canonical tuple encoding prevents ambiguous delimiter collisions. */
export function applicationErrorHash(input: ApplicationErrorInput) {
  return createHash('sha256')
    .update(JSON.stringify(applicationErrorIdentity(input)))
    .digest('hex')
}

function compact(input: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  )
}

function json(value: unknown): JsonValue | undefined {
  if (typeof value !== 'string') return value as JsonValue | undefined
  try {
    return JSON.parse(value) as JsonValue
  } catch {
    return value
  }
}

export function storedReport(row: Record<string, unknown>): ReportRecord {
  return {
    id: Number(row.id),
    appName: String(row.app_name),
    platform: String(row.platform),
    versionCode: Number(row.version_code),
    releaseSequence:
      row.release_sequence === undefined
        ? undefined
        : Number(row.release_sequence),
    reportId: row.report_id as string | null | undefined,
    reportedUsername: row.reported_username as string | null | undefined,
    // Raw JSON selected as text avoids double-decoding MySQL's JSON scalar strings.
    extras: Object.hasOwn(row, 'extras_json')
      ? json(row.extras_json)
      : (row.extras as JsonValue | undefined),
    sourceIp: row.source_ip as string | null | undefined,
    message: row.message as string | null | undefined,
    kind: row.kind as string | undefined,
    stack: row.stack as string | null | undefined,
    errorHash: row.error_hash as string | undefined,
    reportCount:
      row.report_count === undefined ? undefined : Number(row.report_count),
    createdAt: row.created_at as Date | string | null,
    updatedAt: row.updated_at as Date | string | null | undefined
  }
}

function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`
  return JSON.stringify(value)
}

/** Receipt time and network IP are not part of client retry identity. */
export function sameStatusContent(
  stored: ReportRecord,
  input: StatusReportInput,
  message?: string
) {
  return (
    stored.appName === input.appName &&
    stored.platform === input.platform &&
    stored.versionCode === input.versionCode &&
    stored.releaseSequence === input.releaseSequence &&
    (stored.reportedUsername ?? null) === (input.reportedUsername ?? null) &&
    (stored.message ?? null) === (message ?? null) &&
    canonical(stored.extras ?? null) === canonical(input.extras ?? null)
  )
}
