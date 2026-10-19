import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsNumberString,
  IsOptional,
  IsString,
  MaxLength,
  Min
} from 'class-validator'
import { ReleaseScopeType } from '@/api/version/version.dto'

export class ReleaseListQueryDto {
  @IsOptional()
  @IsNumberString()
  page?: string

  @IsOptional()
  @IsNumberString()
  pageSize?: string
}

export class ReplaceReleaseUsersDto {
  @IsArray()
  @ArrayMaxSize(5000)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  userIds: string[]

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number
}

export class ChangeReleaseScopeDto {
  @IsEnum(ReleaseScopeType)
  releaseScope: ReleaseScopeType

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedRevision?: number
}

export class TaskListQueryDto extends ReleaseListQueryDto {
  @IsOptional()
  @IsIn(['pending', 'running', 'retry_wait', 'succeeded', 'failed'])
  status?: string

  @IsOptional()
  @IsString()
  releaseId?: string
}

export class AuditListQueryDto extends ReleaseListQueryDto {
  @IsOptional()
  @IsString()
  action?: string
}
