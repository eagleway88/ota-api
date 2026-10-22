import { ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'

export class TaskQueryDto extends AdminTimeQueryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'running', 'retry_wait', 'succeeded', 'failed']
  })
  @IsOptional()
  @IsIn(['pending', 'running', 'retry_wait', 'succeeded', 'failed'])
  status?: string

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(36)
  releaseId?: string
}

export class TaskLogQueryDto extends AdminTimeQueryDto {
  @ApiPropertyOptional({
    enum: ['running', 'succeeded', 'failed', 'lease_expired']
  })
  @IsOptional()
  @IsIn(['running', 'succeeded', 'failed', 'lease_expired'])
  status?: string
}
