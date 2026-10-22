import { randomUUID } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { fetchIP } from '@/utils'
import type { ApiKeyPrincipal } from '@/auth/api-key.policy'

export type ApiRequest = Request & {
  principal?: ApiKeyPrincipal
}

export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const supplied = req.headers['x-request-id']
  const requestId =
    typeof supplied === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(supplied)
      ? supplied
      : randomUUID()
  req.headers['x-request-id'] = requestId
  res.setHeader('x-request-id', requestId)
  next()
}

export function operationContext(request: ApiRequest) {
  return {
    requestId: String(request.headers['x-request-id'] || randomUUID()),
    sourceIp: fetchIP(request),
    actorType: request.principal ? ('api_key' as const) : ('system' as const),
    actorKeyId: request.principal?.keyId,
    actorName: request.principal?.name
  }
}
