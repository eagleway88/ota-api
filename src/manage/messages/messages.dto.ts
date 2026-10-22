import {
  Allow,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength
} from 'class-validator'

const TARGETED_MESSAGE_ID_MAX_LENGTH = 191

export type { TargetedMessageEnvelope } from '@/contracts/messaging'

export class SendGlobalDto {
  @Allow()
  data?: unknown
}

export class SendApplicationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  appName: string

  @Allow()
  data?: unknown
}

export class MessageSubscriptionsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  appName?: string
}

export class SendUserIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  userId: string

  @Allow()
  data?: unknown

  @IsOptional()
  @IsBoolean()
  resend?: boolean
}

export class SendUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  uniqueId: string

  @Allow()
  data?: unknown

  @IsOptional()
  @IsBoolean()
  resend?: boolean
}

class SendRes {
  messageId?: string
  data: unknown
  updatedAt: string
  expiresAt?: string
  ackRequired: boolean
}

export class SendUserIdRes extends SendRes {
  userId: string
}

export class SendUniqueIdRes extends SendRes {
  uniqueId: string
}
