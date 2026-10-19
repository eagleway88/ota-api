import { Injectable } from '@nestjs/common'
import { JwtService, JwtSignOptions } from '@nestjs/jwt'

@Injectable()
export class AuthService {
  constructor(private jwtService: JwtService) {}

  async signAsync(payload: Buffer | object, options?: JwtSignOptions) {
    return this.jwtService.signAsync(payload, options)
  }
}
