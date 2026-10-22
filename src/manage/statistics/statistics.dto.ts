import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength
} from 'class-validator'
import { ApiPropertyOptional } from '@nestjs/swagger'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'
import { PlatformType } from '@/contracts/release-values'

export class TelemetryQueryDto extends AdminTimeQueryDto {
  @ApiPropertyOptional({ enum: PlatformType })
  @IsOptional()
  @IsEnum(PlatformType)
  platform?: PlatformType

  @ApiPropertyOptional({
    description: 'External release sequence'
  })
  @IsOptional()
  @Matches(/^[1-9]\d{0,9}$/)
  releaseSequence?: string
}

export class ApplicationErrorQueryDto extends AdminTimeQueryDto {
  @ApiPropertyOptional({ enum: PlatformType })
  @IsOptional()
  @IsEnum(PlatformType)
  platform?: PlatformType

  @ApiPropertyOptional({ enum: ['crash', 'error'] })
  @IsOptional()
  @IsIn(['crash', 'error'])
  kind?: 'crash' | 'error'

  @ApiPropertyOptional({ description: 'Exact aggregated error fingerprint' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorHash?: string
}
