import { IsNotEmpty, IsOptional, IsString } from 'class-validator'

/** The only request contract retained for older clients. Unknown legacy fields are tolerated. */
export class LegacyUpdateCheckDto {
  @IsString()
  @IsNotEmpty()
  name: string

  @IsString()
  @IsNotEmpty()
  platform: string

  @IsNotEmpty()
  ver: number | string

  @IsOptional()
  id?: number

  @IsOptional()
  @IsString()
  architecture?: string

  @IsOptional()
  @IsString()
  channel?: string

  @IsOptional()
  @IsString()
  userId?: string
}
