import { Injectable, UnauthorizedException } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'
import { DataSource } from 'typeorm'
import { ApiKeyPrincipal, isApiKeyPreset } from './api-key.policy'

export const keyIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const tokenPattern =
  /^ota_ak_([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.([A-Za-z0-9_-]{43})$/
const digest = (secret: string) =>
  createHash('sha256').update(secret).digest('hex')
export function generateApiKey() {
  const keyId = randomUUID(),
    secret = randomBytes(32).toString('base64url')
  return {
    keyId,
    accessKey: `ota_ak_${keyId}.${secret}`,
    secretHash: digest(secret)
  }
}

@Injectable()
export class ApiKeyService {
  constructor(@InjectDataSource() private readonly source: DataSource) {}

  async authenticate(token: string): Promise<ApiKeyPrincipal> {
    const parsed = tokenPattern.exec(token)
    if (!parsed) throw new UnauthorizedException('Invalid access key')
    // The secret never appears in SQL or driver parameters. No cached authorization state.
    const rows = await this.source.query<
      Array<{
        key_id: string
        name: string
        secret_hash: string
        preset: string
        app_name: string | null
      }>
    >(
      `
      SELECT k.key_id, k.name, k.secret_hash, k.preset, a.app_name
      FROM ota_api_keys k LEFT JOIN ota_api_key_applications g ON g.key_id = k.key_id
      LEFT JOIN ota_applications a ON a.app_name = g.app_name
      WHERE k.key_id = ? AND k.revoked_at IS NULL
        AND (k.expires_at IS NULL OR k.expires_at > UTC_TIMESTAMP(3))`,
      [parsed[1]]
    )
    const key = rows[0]
    if (
      !key ||
      !isApiKeyPreset(key.preset) ||
      !/^[0-9a-f]{64}$/.test(key.secret_hash) ||
      !timingSafeEqual(
        Buffer.from(key.secret_hash, 'hex'),
        Buffer.from(digest(parsed[2]), 'hex')
      )
    ) {
      throw new UnauthorizedException('Invalid access key')
    }
    return {
      type: 'api_key',
      keyId: key.key_id,
      name: key.name,
      preset: key.preset,
      applications: [
        ...new Set(
          rows.flatMap(row => (row.app_name === null ? [] : [row.app_name]))
        )
      ]
    }
  }

  async markUsed(keyId: string) {
    await this.source.query(
      `UPDATE ota_api_keys SET last_used_at = UTC_TIMESTAMP(3)
      WHERE key_id = ? AND (last_used_at IS NULL OR last_used_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 60 SECOND))`,
      [keyId]
    )
  }
}
