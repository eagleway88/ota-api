import { IS_PUBLIC_KEY } from '@/decorators'
import {
  Injectable,
  UnauthorizedException,
  CanActivate,
  ExecutionContext
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { AuthService } from '@/auth/auth.service'
import type { AdministratorRequest } from '@/middleware/request-context'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass()
      ])
    )
      return true
    const request = context.switchToHttp().getRequest<AdministratorRequest>()
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')
    if (!match) throw new UnauthorizedException('Missing bearer access token')
    request.user = await this.auth.authenticate(match[1])
    return true
  }
}
