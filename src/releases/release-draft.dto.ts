import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min
} from 'class-validator'
import { PartialType } from '@nestjs/swagger'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'
import {
  PlatformType,
  ReleaseScopeType,
  UpdateType
} from '@/contracts/release-values'

export class CreateReleaseDraftDto {
  @IsInt()
  @Min(0)
  targetVersionCode: number

  @IsArray()
  @IsInt({ each: true })
  compatibleBaseVersionCodes: number[]

  @IsArray()
  @IsEnum(PlatformType, { each: true })
  platforms: PlatformType[]

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  architectures?: string[]

  @IsOptional()
  @IsString()
  distributionChannel?: string

  @IsEnum(UpdateType)
  updateType: UpdateType

  @IsEnum(ReleaseScopeType)
  releaseScope: ReleaseScopeType

  @IsArray()
  @ArrayMaxSize(MAX_RELEASE_USERS)
  @IsString({ each: true })
  @MaxLength(191, { each: true })
  userIds: string[]

  @IsOptional()
  @IsString()
  releaseNotes?: string

  @IsOptional()
  @IsString()
  artifactId?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  installerSourceUrl?: string

  @IsOptional()
  @IsUrl({ require_tld: false })
  bundleUrl?: string

  @IsOptional()
  @IsInt()
  @Min(0)
  artifactSizeBytes?: number

  @IsOptional()
  @IsBoolean()
  enabled?: boolean

  @IsOptional()
  @IsBoolean()
  mandatory?: boolean

  @IsOptional()
  @IsBoolean()
  showUpdateDialog?: boolean
}

export class UpdateReleaseDraftDto extends PartialType(CreateReleaseDraftDto) {}
