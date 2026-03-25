import { IS_PUBLIC_KEY } from '@/decorators'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { CanActivate, ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import { Request } from 'express'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ])
    if (isPublic) {
      return true
    }
    const secret = this.configService.get('JWT_SECRET')
    const request = context.switchToHttp().getRequest<Request>()
    const [type, auth] = request.headers.authorization?.split(' ') ?? []
    const token = type === 'Bearer' ? auth : null
    if (!token) {
      throw new UnauthorizedException('Missing token')
    }
    try {
      await this.jwtService.verifyAsync(token, {
        secret: secret
      })
    } catch {
      throw new UnauthorizedException('Invalid token')
    }
    return true
  }
}
