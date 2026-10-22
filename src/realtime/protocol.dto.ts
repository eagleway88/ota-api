import { IsNotEmpty, IsString, MaxLength } from 'class-validator'

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
  @MaxLength(191)
  uniqueId: string

  @IsString()
  @IsNotEmpty()
  messageId: string
}
