import { BadRequestException, Injectable } from '@nestjs/common'
import { isUUID } from 'class-validator'
import {
  ApplicationErrorInput,
  ClientReport,
  FailureReportInput,
  StatusReportInput,
  TelemetryWriteRepository
} from './ports/telemetry-write.repository'

@Injectable()
export class TelemetryWriteService {
  constructor(private readonly reports: TelemetryWriteRepository) {}

  success(input: StatusReportInput) {
    this.validateStatus(input)
    return this.reports.success(input, { receivedAt: new Date() })
  }

  failure(input: FailureReportInput) {
    this.validateStatus(input)
    this.requireText(input.message)
    if (input.recordId !== undefined) this.positiveId(input.recordId)
    return this.reports.failure(input, { receivedAt: new Date() })
  }

  applicationError(input: ApplicationErrorInput) {
    this.validateClient(input)
    this.requireText(input.kind)
    this.requireText(input.message)
    return this.reports.applicationError(input, { receivedAt: new Date() })
  }

  private validateStatus(input: StatusReportInput) {
    this.validateClient(input)
    this.positiveId(input.releaseSequence)
    if (input.reportId !== undefined && !isUUID(input.reportId))
      throw new BadRequestException('Invalid reportId')
  }

  private validateClient(input: ClientReport) {
    if (
      !input.appName ||
      !input.platform ||
      !Number.isSafeInteger(input.versionCode) ||
      input.versionCode < 0 ||
      input.versionCode > 2_147_483_647
    )
      throw new BadRequestException('Invalid client report context')
  }

  private positiveId(value: number) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647)
      throw new BadRequestException('Invalid report or release ID')
  }

  private requireText(value: string) {
    if (typeof value !== 'string' || !value.trim())
      throw new BadRequestException('Report text is required')
  }
}
