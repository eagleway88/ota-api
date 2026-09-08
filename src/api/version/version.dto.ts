import { IsString, IsNumber, IsNotEmpty, IsOptional } from 'class-validator'
import { IsEnum, IsIn, IsNumberString, Matches } from 'class-validator'
import { ApiProperty, OmitType } from '@nestjs/swagger'

export enum PlatformType {
  iOS = 'ios',
  Android = 'android',
  Windows = 'windows',
  Linux = 'linux',
  Macos = 'macos'
}

export enum UpdateType {
  Full = 'full',
  Hot = 'hot'
}

export enum AppErrorKind {
  Crash = 'crash',
  Error = 'error'
}

export class VersionDto {
  @IsNumber()
  @IsNotEmpty()
  id: number

  /** 版本号(1.0.0=100) */
  @IsNotEmpty()
  ver: number | string

  /** 适用基础版本(多版本用逗号拼接100,101) */
  @IsOptional()
  @IsString()
  baseVersions?: string

  /** 应用名称 */
  @IsString()
  @IsNotEmpty()
  name: string

  /** 平台(多平台用逗号拼接ios,android) */
  @IsString()
  @IsNotEmpty()
  platform: string

  /** 架构(多架构用逗号拼接arm64,x64) */
  @IsOptional()
  @IsString()
  architecture?: string

  /** 更新描述 */
  desc?: string
  /** 文件大小 */
  fileSize?: number
  /** 是否启用 */
  enable?: number
  /** 是否强制更新 */
  mandatory?: number
  /** 是否显示弹窗 */
  showDialog?: number
  /** 安装链接(全量更新时不为null) */
  installUrl?: string
  /** 热更新链接(热更新时不为null) */
  packageUrl?: string
  /** 渠道(appstore或其它,用于全量更新下发不同的链接) */
  channel?: string
  /** 更新类型(full=全量更新 hot=热更新) */
  updateType?: UpdateType
}

export class VersionListQueryDto {
  /** 应用名称 */
  @IsString()
  @IsNotEmpty()
  name: string

  /** 版本表记录ID */
  @IsOptional()
  @IsNumberString()
  id?: string

  /** 版本号，支持100或1.0.0 */
  @IsOptional()
  @Matches(/^\d+(?:\.\d+)*$/)
  ver?: string

  /** 平台 */
  @IsOptional()
  @IsString()
  platform?: string

  /** 架构 */
  @IsOptional()
  @IsString()
  architecture?: string

  /** 渠道 */
  @IsOptional()
  @IsString()
  channel?: string

  /** 更新类型 */
  @IsOptional()
  @IsEnum(UpdateType)
  updateType?: UpdateType

  /** 是否启用 */
  @IsOptional()
  @IsIn(['0', '1'])
  enable?: string

  /** 是否强制更新 */
  @IsOptional()
  @IsIn(['0', '1'])
  mandatory?: string

  /** 是否显示弹窗 */
  @IsOptional()
  @IsIn(['0', '1'])
  showDialog?: string
}

export class VersionListItemDto extends VersionDto {
  /** 创建IP */
  ip?: string

  /** 创建时间 */
  createTime?: Date | string

  /** 安装成功上报总数 */
  @IsNumber()
  successCount: number

  /** 安装失败上报总数 */
  @IsNumber()
  errorCount: number
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

  /** 架构 */
  @IsOptional()
  @IsString()
  architecture?: string

  /** 已更新的版本ID */
  id?: number
}

export class UploadDto extends OmitType(VersionDto, ['id', 'ver']) {
  /** 版本号(1.0.0=100) */
  @IsString()
  @IsNotEmpty()
  ver: string

  @ApiProperty({
    type: 'string',
    format: 'binary'
  })
  file: any
}

export class CreateDto extends OmitType(VersionDto, ['id']) {}

export class SuccessDto extends OmitType(StatusDto, ['id']) {}

export class ErrorDto extends OmitType(StatusDto, ['id']) {
  id?: number

  @IsString()
  @IsNotEmpty()
  message: string
}

export class AppErrorLogDto extends OmitType(StatusDto, ['id', 'verId']) {
  @IsString()
  @IsNotEmpty()
  kind: AppErrorKind

  @IsString()
  @IsNotEmpty()
  message: string

  @IsOptional()
  @IsString()
  stack?: string
}
