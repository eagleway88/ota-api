import { randomUUID } from 'crypto'
import type { NextFunction, Request, Response } from 'express'
import { fetchIP } from '@/utils'

export type AdministratorRequest = Request & {
  user?: { sub: number; username: string; sid: string }
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

export function administratorContext(request: AdministratorRequest) {
  return {
    requestId: String(request.headers['x-request-id'] || randomUUID()),
    sourceIp: fetchIP(request),
    actorAdminId: request.user?.sub,
    actorName: request.user?.username
  }
}
