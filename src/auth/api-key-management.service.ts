import { DataSource } from 'typeorm'
import { randomUUID } from 'crypto'
import { ApiKeyPreset, isApiKeyPreset, validApiKeyName } from './api-key.policy'
import { generateApiKey, keyIdPattern } from './api-key.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { GlobalAuditContext, insertGlobalAudit } from '@/audit/global-audit'

export type CreateApiKey = {
  name: string
  applications: string[]
  preset: ApiKeyPreset
  expiresAt: Date | null
}

/** CLI-only capability: not registered as an HTTP provider/controller. */
export class ApiKeyManagementService {
  constructor(private readonly source: DataSource) {}

  async create(input: CreateApiKey, context: GlobalAuditContext) {
    if (!validApiKeyName(input.name)) throw new Error('Invalid key name')
    if (!isApiKeyPreset(input.preset)) throw new Error('Unknown key preset')
    if (
      !Array.isArray(input.applications) ||
      !input.applications.length ||
      input.applications.length > 100
    )
      throw new Error('Explicitly grant between 1 and 100 applications')
    const resolver = new ApplicationTableResolver()
    for (const app of input.applications) resolver.validateAppName(app)
    const apps = [...new Set(input.applications)].sort()
    if (apps.length !== input.applications.length)
      throw new Error('Duplicate application grants')
    if (
      input.expiresAt !== null &&
      (!(input.expiresAt instanceof Date) ||
        !Number.isFinite(input.expiresAt.getTime()) ||
        input.expiresAt.getTime() <= Date.now())
    )
      throw new Error('Expiry must be a future date or null')
    const key = generateApiKey(),
      runner = this.source.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction()
      const registered = (await runner.query(
        `SELECT app_name FROM ota_applications
        WHERE app_name IN (${apps.map(() => '?').join(',')}) AND status = 'ready' ORDER BY app_name FOR UPDATE`,
        apps
      )) as Array<{ app_name: string }>
      if (
        registered.length !== apps.length ||
        apps.some(app => !registered.some(row => row.app_name === app))
      )
        throw new Error(
          'Every granted application must be registered and ready; prepare it with the CLI first'
        )
      await runner.query(
        `INSERT INTO ota_api_keys (key_id, name, secret_hash, preset, expires_at, created_at)
        VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [
          key.keyId,
          input.name,
          key.secretHash,
          input.preset,
          input.expiresAt?.toISOString().slice(0, 23).replace('T', ' ') ?? null
        ]
      )
      await runner.query(
        `INSERT INTO ota_api_key_applications (key_id, app_name) VALUES ${apps.map(() => '(?, ?)').join(',')}`,
        apps.flatMap(app => [key.keyId, app])
      )
      await insertGlobalAudit(runner, {
        context,
        actorType: 'operator',
        action: 'api_key_created',
        targetType: 'api_key',
        targetId: key.keyId,
        result: 'succeeded',
        operationId: randomUUID(),
        changeSummary: {
          name: input.name,
          preset: input.preset,
          applications: apps,
          expiresAt: input.expiresAt?.toISOString() ?? null
        }
      })
      await runner.commitTransaction()
      return {
        keyId: key.keyId,
        accessKey: key.accessKey,
        name: input.name,
        preset: input.preset,
        applications: apps,
        expiresAt: input.expiresAt?.toISOString() ?? null
      }
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }

  async list(appName?: string) {
    if (appName !== undefined)
      new ApplicationTableResolver().validateAppName(appName)
    const rows = await this.source.query<
      Array<Record<string, unknown> & { keyId: string }>
    >(
      `SELECT k.key_id AS keyId, k.name, k.preset,
      DATE_FORMAT(k.created_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS createdAt,
      DATE_FORMAT(k.expires_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS expiresAt,
      DATE_FORMAT(k.revoked_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS revokedAt,
      DATE_FORMAT(k.last_used_at, '%Y-%m-%dT%H:%i:%s.%fZ') AS lastUsedAt,
      CASE WHEN k.revoked_at IS NOT NULL THEN 'revoked'
        WHEN k.expires_at <= UTC_TIMESTAMP(3) THEN 'expired' ELSE 'active' END AS status
      FROM ota_api_keys k ${appName ? 'WHERE EXISTS (SELECT 1 FROM ota_api_key_applications g WHERE g.key_id = k.key_id AND g.app_name = ?)' : ''}
      ORDER BY k.created_at, k.key_id`,
      appName ? [appName] : []
    )
    if (!rows.length) return []
    const grants = await this.source.query<
      Array<{ key_id: string; app_name: string }>
    >(`SELECT key_id, app_name FROM ota_api_key_applications ORDER BY app_name`)
    return rows.map(row => ({
      ...row,
      applications: grants
        .filter(g => g.key_id === row.keyId)
        .map(g => g.app_name)
    }))
  }

  async inspect(keyId: string) {
    if (!keyIdPattern.test(keyId)) throw new Error('Invalid key ID')
    const key = (await this.list()).find(row => row.keyId === keyId)
    if (!key) throw new Error('Access key not found')
    return key
  }

  async revoke(keyId: string, context: GlobalAuditContext) {
    if (!keyIdPattern.test(keyId)) throw new Error('Invalid key ID')
    const runner = this.source.createQueryRunner()
    await runner.connect()
    try {
      await runner.startTransaction()
      const keys = (await runner.query(
        'SELECT revoked_at FROM ota_api_keys WHERE key_id = ? FOR UPDATE',
        [keyId]
      )) as Array<{ revoked_at: unknown }>
      if (!keys.length) throw new Error('Access key not found')
      if (!keys[0].revoked_at) {
        await runner.query(
          'UPDATE ota_api_keys SET revoked_at = UTC_TIMESTAMP(3) WHERE key_id = ?',
          [keyId]
        )
        await insertGlobalAudit(runner, {
          context,
          actorType: 'operator',
          action: 'api_key_revoked',
          targetType: 'api_key',
          targetId: keyId,
          result: 'succeeded'
        })
      }
      await runner.commitTransaction()
      return { keyId, revoked: true }
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    } finally {
      await runner.release()
    }
  }
}
