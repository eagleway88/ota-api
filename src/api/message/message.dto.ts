import { IsNotEmpty, IsString } from 'class-validator'

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

export class SendUniqueIdDto {
  @IsString()
  @IsNotEmpty()
  uniqueId: string

  data?: any

  resend?: boolean
}