import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

export function validDeviceTarget(
  value: unknown
): value is { appName: string; uniqueId: string } {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  return (
    typeof target.appName === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(target.appName) &&
    typeof target.uniqueId === 'string' &&
    target.uniqueId.length > 0 &&
    target.uniqueId.length <= 191
  )
}

export class AckUserIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  userId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}

export class AckUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  appName: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  uniqueId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}
