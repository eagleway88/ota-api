import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsISO8601, IsOptional, Matches } from 'class-validator'

export class AdminPageQueryDto {
  @ApiPropertyOptional({ default: '1', description: 'Positive page number' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,5}$/)
  page?: string

  @ApiPropertyOptional({ default: '20', description: '1–100 rows per page' })
  @IsOptional()
  @Matches(/^[1-9]\d{0,2}$/)
  pageSize?: string
}

export class AdminTimeQueryDto extends AdminPageQueryDto {
  @ApiPropertyOptional({
    description:
      'Inclusive ISO 8601 timestamp with timezone; defaults to 30 days before to'
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  from?: string

  @ApiPropertyOptional({
    description:
      'Exclusive ISO 8601 timestamp with timezone; defaults to now. Maximum range: 90 days'
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  @Matches(/(?:Z|[+-]\d{2}:\d{2})$/)
  to?: string
}
