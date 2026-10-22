import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(191)
  username: string

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  password: string
}

export class InitializeAdministratorDto extends LoginDto {
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  declare password: string
}

export class AdministratorDto {
  @ApiProperty()
  id: number

  @ApiProperty()
  username: string
}

export class AdministratorSessionDto {
  @ApiProperty()
  accessToken: string

  @ApiProperty({ example: 'Bearer' })
  tokenType: string

  @ApiProperty({ example: 3600 })
  expiresIn: number

  @ApiProperty({ type: AdministratorDto })
  administrator: AdministratorDto
}
