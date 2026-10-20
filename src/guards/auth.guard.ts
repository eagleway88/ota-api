import { IS_PUBLIC_KEY } from '@/decorators'
import { Injectable, UnauthorizedException } from '@nestjs/common'
import { CanActivate, ExecutionContext } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { Admin } from '@/entities/admin.entity'

type AuthPayload = {
  sub?: number
  uid?: number
  username?: string
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectRepository(Admin) private readonly administrators: Repository<Admin>
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass()
    ])
    if (isPublic) {
      return true
    }
    const secret = this.configService.get<string>('JWT_SECRET')
    const request = context.switchToHttp().getRequest<Request>()
    const [type, auth] = request.headers.authorization?.split(' ') ?? []
    const token = type === 'Bearer' ? auth : null
    if (!token) {
      throw new UnauthorizedException('Missing token')
    }
    let payload: AuthPayload
    try {
      payload = await this.jwtService.verifyAsync<AuthPayload>(token, {
        secret
      })
    } catch {
      throw new UnauthorizedException('Invalid token')
    }
    const id = payload.sub ?? payload.uid
    // Older administrator tokens contained only username.
    const where =
      typeof id === 'number' && Number.isSafeInteger(id) && id > 0
        ? { id }
        : id === undefined &&
            typeof payload.username === 'string' &&
            payload.username.length > 0
          ? { username: payload.username }
          : undefined
    if (!where)
      throw new UnauthorizedException('Administrator identity is missing')
    const admin = await this.administrators.findOne({
      where,
      select: { id: true, username: true }
    })
    if (!admin)
      throw new UnauthorizedException('Administrator no longer exists')
    ;(request as Request & { user?: AuthPayload }).user = {
      sub: admin.id,
      uid: admin.id,
      username: admin.username
    }
    return true
  }
}
