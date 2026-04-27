import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

const TARGETED_MESSAGE_ID_MAX_LENGTH = 191

export type TargetedMessageEnvelope = {
  messageId: string | null
  data: any
  updatedAt: string
  expiresAt: string | null
  ackRequired: boolean
}

export class SendGlobalDto {
  data?: any
}

export class SendOtaNameDto {
  @IsString()
  @IsNotEmpty()
  otaName: string

  data?: any

}

export class SendUserIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  userId: string

  data?: any

  resend?: boolean

}

export class AckUserIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  userId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}

export class SendUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  uniqueId: string

  data?: any

  resend?: boolean
}

export class AckUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(TARGETED_MESSAGE_ID_MAX_LENGTH)
  uniqueId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}

class SendRes {
  messageId?: string
  data: any
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