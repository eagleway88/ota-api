import { IsNotEmpty, IsString } from 'class-validator'

export type TargetedMessageEnvelope = {
  messageId: string | null
  data: any
  updatedAt: string
  expiresAt: string | null
  ackRequired: boolean
}

export class SendGlobalDto {
  @IsString()
  @IsNotEmpty()
  type: string

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
  userId: string

  data?: any

  resend?: boolean

}

export class AckUserIdDto {
  @IsString()
  @IsNotEmpty()
  userId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}

export class SendUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  uniqueId: string

  data?: any

  resend?: boolean
}

export class AckUniqueIdDto {
  @IsString()
  @IsNotEmpty()
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