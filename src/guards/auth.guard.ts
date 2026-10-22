import { IS_PUBLIC_KEY } from '@/decorators'
import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  CanActivate,
  ExecutionContext
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApiKeyService } from '@/auth/api-key.service'
import { API_PERMISSION, permits } from '@/auth/api-key.policy'
import type { ApiPermission } from '@/auth/api-key.policy'
import type { ApiRequest } from '@/middleware/request-context'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly keys: ApiKeyService
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
        context.getHandler(),
        context.getClass()
      ])
    )
      return true
    const request = context.switchToHttp().getRequest<ApiRequest>()
    const match = /^Bearer ([^\s]+)$/i.exec(request.headers.authorization ?? '')
    if (!match) throw new UnauthorizedException('Missing access key')
    const principal = await this.keys.authenticate(match[1])
    const permission = this.reflector.getAllAndOverride<ApiPermission>(
      API_PERMISSION,
      [context.getHandler(), context.getClass()]
    )
    const appName = request.params.appName
    if (
      !permission ||
      typeof appName !== 'string' ||
      !permits(principal, appName, permission)
    )
      throw new ForbiddenException(
        'Access key is not authorized for this application or operation'
      )
    request.principal = principal
    await this.keys.markUsed(principal.keyId)
    return true
  }
}
