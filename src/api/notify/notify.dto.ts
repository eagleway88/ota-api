import { IsNotEmpty, IsString } from 'class-validator'

export class SendDto {
  @IsString()
  @IsNotEmpty()
  type: string

  data: any
}