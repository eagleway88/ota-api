import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min
} from 'class-validator'
import { PlatformType } from '@/contracts/release-values'

export class UpdateCheckDto {
  @IsEnum(PlatformType) platform: PlatformType
  @IsInt() @Min(0) @Max(2147483647) nativeVersionCode: number
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(2147483647)
  installedReleaseSequence?: number
  @IsOptional() @IsString() @MaxLength(128) architecture?: string
  @IsOptional() @IsString() @MaxLength(128) distributionChannel?: string
  @IsOptional() @IsString() @MaxLength(191) userId?: string
}
