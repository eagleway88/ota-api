
import { IsString, IsNumber, IsNotEmpty } from 'class-validator'
import { ApiProperty, OmitType } from '@nestjs/swagger'

export enum PlatformType {
  iOS = 'ios',
  Android = 'android',
  Windows = 'windows',
  Linux = 'linux',
  Mac = 'mac'
}

export class VersionDto {
  @IsNumber()
  @IsNotEmpty()
  id: number

  /** 版本号(1.0.0=100) */
  @IsNumber()
  @IsNotEmpty()
  ver: number

  /** 应用名称 */
  @IsString()
  @IsNotEmpty()
  name: string

  /** 平台(多平台用逗号拼接ios,android) */
  @IsString()
  @IsNotEmpty()
  platform: string

  /** 更新描述 */
  desc?: string
  /** 文件大小 */
  fileSize?: number
  /** 是否启用 */
  enable?: number
  /** 是否强制更新 */
  mandatory?: number
  /** 安装链接(全量更新时不为null) */
  installUrl?: string
  /** 热更新链接(热更新时不为null) */
  packageUrl?: string
  /** 渠道(appstore或其它,用于全量更新下发不同的链接) */
  channel?: string
}

export class StatusDto {
  @IsNumber()
  @IsNotEmpty()
  id: number

  /** 版本号(1.0.0=100) */
  @IsNumber()
  @IsNotEmpty()
  ver: number

  /** tableName_version表id */
  @IsNumber()
  @IsNotEmpty()
  verId: number

  /** 应用名称 */
  @IsString()
  @IsNotEmpty()
  name: string

  /** 平台 */
  @IsString()
  @IsNotEmpty()
  platform: PlatformType

  username?: string
  extras?: string
}

export class CheckDto extends OmitType(VersionDto, ['id', 'platform']) {
  /** 平台 */
  @IsString()
  @IsNotEmpty()
  platform: PlatformType

  /** 已更新的版本ID */
  id?: number
}

export class UploadDto extends OmitType(VersionDto, ['id']) {
  @ApiProperty({
    type: 'string',
    format: 'binary'
  })
  file: any
}

export class CreateDto extends OmitType(VersionDto, ['id']) {

}

export class SuccessDto extends OmitType(StatusDto, ['id']) {

}

export class ErrorDto extends OmitType(StatusDto, ['id']) {
  @IsString()
  @IsNotEmpty()
  message: string
}