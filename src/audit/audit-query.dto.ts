import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'

export class AuditQueryDto extends AdminTimeQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string

  @ApiPropertyOptional({ enum: ['succeeded', 'failed'] })
  @IsOptional()
  @IsIn(['succeeded', 'failed'])
  result?: string

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^[1-9]\d{0,9}$/)
  actorAdminId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  requestId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  operationId?: string
}

export class ApplicationAuditQueryDto extends AuditQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  releaseId?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  taskId?: string
}
