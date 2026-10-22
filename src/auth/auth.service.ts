import {
  ForbiddenException,
  Injectable,
  UnauthorizedException
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { InjectDataSource } from '@nestjs/typeorm'
import { randomUUID, timingSafeEqual } from 'crypto'
import { DataSource } from 'typeorm'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'

export type AdministratorIdentity = {
  sub: number
  username: string
  sid: string
}
type AccessClaims = {
  sub?: unknown
  sid?: unknown
  tokenType?: unknown
  exp?: unknown
  iat?: unknown
}

export const administratorJwtOptions = {
  issuer: 'ota-api',
  audience: 'ota-manage',
  algorithm: 'HS256' as const
}

export function accessTokenLifetime(config: ConfigService) {
  const seconds = Number(config.get('ADMIN_ACCESS_TOKEN_TTL_SECONDS') ?? 3600)
  if (!Number.isSafeInteger(seconds) || seconds < 60 || seconds > 86400) {
    throw new Error(
      'ADMIN_ACCESS_TOKEN_TTL_SECONDS must be between 60 and 86400'
    )
  }
  return seconds
}

@Injectable()
export class AuthService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @InjectDataSource() private readonly source: DataSource
  ) {}

  assertInitializationToken(token?: string) {
    const expected = this.config.get<string>('ADMIN_INITIALIZATION_TOKEN')
    if (!expected || expected.length < 32 || !token || token.length > 1024) {
      throw new ForbiddenException(
        'Administrator initialization is disabled or unauthorized'
      )
    }
    const supplied = Buffer.from(token)
    const configured = Buffer.from(expected)
    if (
      supplied.length !== configured.length ||
      !timingSafeEqual(supplied, configured)
    ) {
      throw new ForbiddenException(
        'Administrator initialization is disabled or unauthorized'
      )
    }
  }

  async createSession(
    admin: { id: number; username: string },
    context: GlobalAuditContext
  ) {
    const sid = randomUUID()
    const expiresIn = accessTokenLifetime(this.config)
    const accessToken = await this.jwt.signAsync(
      { sub: String(admin.id), sid, tokenType: 'admin-access' },
      {
        ...administratorJwtOptions,
        expiresIn
      }
    )
    const runner = this.source.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction()
      const administrators = (await runner.query(
        'SELECT id FROM admins WHERE id = ? FOR UPDATE',
        [admin.id]
      )) as unknown[]
      if (!administrators.length)
        throw new UnauthorizedException('Administrator no longer exists')
      await runner.query(
        `INSERT INTO ota_admin_sessions
        (session_id, admin_id, created_at, expires_at) VALUES (?, ?, UTC_TIMESTAMP(3), DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND))`,
        [sid, admin.id, expiresIn]
      )
      await insertGlobalAudit(runner, {
        context: {
          ...context,
          actorAdminId: admin.id,
          actorName: admin.username
        },
        operationId: randomUUID(),
        actorType: 'admin',
        action: 'admin_login',
        targetType: 'admin_session',
        targetId: sid,
        result: 'succeeded'
      })
      await runner.commitTransaction()
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn,
      administrator: { id: admin.id, username: admin.username }
    }
  }

  async authenticate(token: string): Promise<AdministratorIdentity> {
    let claims: AccessClaims
    try {
      claims = await this.jwt.verifyAsync<AccessClaims>(token, {
        issuer: administratorJwtOptions.issuer,
        audience: administratorJwtOptions.audience,
        algorithms: ['HS256']
      })
    } catch {
      throw new UnauthorizedException('Invalid or expired access token')
    }
    if (
      claims.tokenType !== 'admin-access' ||
      typeof claims.exp !== 'number' ||
      typeof claims.iat !== 'number' ||
      !Number.isSafeInteger(claims.exp) ||
      !Number.isSafeInteger(claims.iat) ||
      claims.exp <= claims.iat ||
      claims.exp - claims.iat > 86400 ||
      typeof claims.sub !== 'string' ||
      !/^[1-9]\d{0,9}$/.test(claims.sub) ||
      typeof claims.sid !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        claims.sid
      )
    ) {
      throw new UnauthorizedException('Invalid administrator identity')
    }
    const rows = await this.source.query<
      Array<{ id: number; username: string }>
    >(
      `
      SELECT a.id, a.username FROM admins a
      JOIN ota_admin_sessions s ON s.admin_id = a.id
      WHERE s.session_id = ? AND s.admin_id = ? AND s.revoked_at IS NULL
        AND s.expires_at > UTC_TIMESTAMP(3) LIMIT 1`,
      [claims.sid, Number(claims.sub)]
    )
    const admin = rows[0]
    if (!admin)
      throw new UnauthorizedException('Administrator session is inactive')
    return { sub: admin.id, username: admin.username, sid: claims.sid }
  }

  async revoke(
    identity: AdministratorIdentity,
    context: GlobalAuditContext,
    all = false
  ) {
    const runner = this.source.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction()
      await runner.query('SELECT id FROM admins WHERE id = ? FOR UPDATE', [
        identity.sub
      ])
      await runner.query(
        `UPDATE ota_admin_sessions SET revoked_at = UTC_TIMESTAMP(3)
        WHERE admin_id = ? AND revoked_at IS NULL${all ? '' : ' AND session_id = ?'}`,
        all ? [identity.sub] : [identity.sub, identity.sid]
      )
      await insertGlobalAudit(runner, {
        context,
        operationId: randomUUID(),
        actorType: 'admin',
        action: all ? 'admin_logout_all' : 'admin_logout',
        targetType: 'admin_session',
        targetId: all ? String(identity.sub) : identity.sid,
        result: 'succeeded'
      })
      await runner.commitTransaction()
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }
}
