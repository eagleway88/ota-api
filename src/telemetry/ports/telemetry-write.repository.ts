export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export type ClientReport = {
  appName: string
  platform: string
  versionCode: number
  reportedUsername?: string | null
  extras?: JsonValue
  sourceIp?: string | null
}
export type StatusReportInput = ClientReport & {
  releaseSequence: number
  reportId?: string
}
export type FailureReportInput = StatusReportInput & {
  recordId?: number
  message: string
}
export type ApplicationErrorInput = ClientReport & {
  kind: string
  message: string
  stack?: string | null
}
export type ReportWriteContext = { receivedAt: Date }
export type ReportRecord = ClientReport & {
  id: number
  releaseSequence?: number
  reportId?: string | null
  message?: string | null
  kind?: string
  stack?: string | null
  errorHash?: string
  reportCount?: number
  createdAt: Date | string | null
  updatedAt?: Date | string | null
}

/** Each operation owns its transaction; no HTTP, legacy columns or DDL in the port. */
export abstract class TelemetryWriteRepository {
  abstract success(
    input: StatusReportInput,
    context: ReportWriteContext
  ): Promise<ReportRecord>
  abstract failure(
    input: FailureReportInput,
    context: ReportWriteContext
  ): Promise<ReportRecord>
  abstract applicationError(
    input: ApplicationErrorInput,
    context: ReportWriteContext
  ): Promise<ReportRecord>
}
