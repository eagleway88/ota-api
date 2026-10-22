import { IsNotEmpty, IsString } from 'class-validator'

export class AdminDto {
  @IsString()
  @IsNotEmpty()
  username: string

  @IsString()
  @IsNotEmpty()
  password: string
}
