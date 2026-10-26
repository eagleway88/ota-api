import { APP_VERSION_PATTERN } from '@/contracts/version'
import {
  Allow,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  IsUUID,
  Max,
  MaxLength,
  Min
} from 'class-validator'
import { PlatformType } from '@/contracts/release-values'
import type { JsonValue } from '@/telemetry/ports/telemetry-write.repository'

export class ClientReportDto {
  @IsEnum(PlatformType)
  platform: PlatformType

  @IsString()
  @Matches(APP_VERSION_PATTERN)
  @MaxLength(128)
  version: string

  @IsOptional()
  @IsString()
  @MaxLength(191)
  reportedUsername?: string | null

  @Allow()
  extras?: JsonValue
}

export class StatusReportDto extends ClientReportDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  releaseSequence: number

  @IsOptional()
  @IsUUID()
  reportId?: string
}

export class FailureReportDto extends StatusReportDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  recordId?: number

  @IsString()
  @IsNotEmpty()
  message: string
}

export class ApplicationErrorReportDto extends ClientReportDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  kind: string

  @IsString()
  @IsNotEmpty()
  message: string

  @IsOptional()
  @IsString()
  stack?: string | null
}
