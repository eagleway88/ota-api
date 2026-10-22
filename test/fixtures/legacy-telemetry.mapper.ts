import {
  ApplicationErrorInput,
  ClientReport,
  FailureReportInput,
  JsonValue,
  ReportRecord,
  StatusReportInput
} from '@/telemetry/ports/telemetry-write.repository'
import { underlineToHump } from '@/utils'
import { AppErrorLogDto, ErrorDto, SuccessDto } from './legacy-version.dto'

function client(
  body: SuccessDto | AppErrorLogDto,
  sourceIp: string
): ClientReport {
  let extras: JsonValue | undefined
  if (body.extras) {
    try {
      extras = JSON.parse(body.extras) as JsonValue
    } catch {
      extras = body.extras
    }
  }
  return {
    appName: body.name,
    platform: body.platform,
    versionCode: body.ver,
    reportedUsername: body.username,
    extras,
    sourceIp
  }
}

export function legacySuccessReport(
  body: SuccessDto,
  sourceIp: string
): StatusReportInput {
  return {
    ...client(body, sourceIp),
    releaseSequence: body.verId,
    reportId: body.reportId || undefined
  }
}

export function legacyFailureReport(
  body: ErrorDto,
  sourceIp: string
): FailureReportInput {
  return {
    ...legacySuccessReport(body, sourceIp),
    recordId: body.id || undefined,
    message: body.message
  }
}

export function legacyApplicationError(
  body: AppErrorLogDto,
  sourceIp: string
): ApplicationErrorInput {
  return {
    ...client(body, sourceIp),
    kind: body.kind,
    message: body.message,
    stack: body.stack
  }
}

export function serializeLegacyReport(record: ReportRecord) {
  return Object.fromEntries(
    Object.entries({
      id: record.id,
      name: record.appName,
      platform: record.platform,
      ver: record.versionCode,
      verId: record.releaseSequence,
      ip: record.sourceIp,
      // Preserve the historical wire conversion only here, never in formal storage.
      extras: underlineToHump(record.extras),
      username: record.reportedUsername,
      message: record.message,
      kind: record.kind,
      stack: record.stack,
      errorHash: record.errorHash,
      reportCount: record.reportCount,
      createTime: record.createdAt,
      updateTime: record.updatedAt
    }).filter(([, value]) => value !== undefined)
  )
}
