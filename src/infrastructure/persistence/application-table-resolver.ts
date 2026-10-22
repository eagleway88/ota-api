import { BadRequestException, Injectable } from '@nestjs/common'
import { createHash } from 'crypto'

export type ApplicationTables = {
  prefix: string
  version: string
  releaseUser: string
  releaseDraft: string
  artifact: string
  success: string
  error: string
  errorLog: string
  publishTask: string
  publishTaskLog: string
  auditLog: string
}

const MAX_TABLE_PREFIX_LENGTH = 40

@Injectable()
export class ApplicationTableResolver {
  validateAppName(appName: string) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(appName)) {
      throw new BadRequestException('Invalid application name')
    }
  }

  normalizedPrefix(appName: string) {
    this.validateAppName(appName)
    return appName.replace(/[^A-Za-z0-9_]/g, '_')
  }

  collisionSafePrefix(appName: string) {
    const normalizedPrefix = this.normalizedPrefix(appName)
    if (normalizedPrefix.length <= MAX_TABLE_PREFIX_LENGTH) {
      return normalizedPrefix
    }

    return this.hashedPrefix(appName)
  }

  hashedPrefix(appName: string) {
    const normalizedPrefix = this.normalizedPrefix(appName)
    const digest = createHash('sha256')
      .update(appName)
      .digest('hex')
      .slice(0, 8)
    return `${normalizedPrefix.slice(0, MAX_TABLE_PREFIX_LENGTH - 9)}_${digest}`
  }

  resolve(appName: string, registeredPrefix?: string): ApplicationTables {
    this.validateAppName(appName)
    const prefix = registeredPrefix ?? this.normalizedPrefix(appName)
    if (!/^[A-Za-z0-9_]{1,40}$/.test(prefix)) {
      throw new BadRequestException('Invalid registered table prefix')
    }

    return {
      prefix,
      version: `${prefix}_version`,
      releaseUser: `${prefix}_release_user`,
      releaseDraft: `${prefix}_release_draft`,
      artifact: `${prefix}_artifact`,
      success: `${prefix}_success`,
      error: `${prefix}_error`,
      errorLog: `${prefix}_error_log`,
      publishTask: `${prefix}_publish_task`,
      publishTaskLog: `${prefix}_publish_task_log`,
      auditLog: `${prefix}_audit_log`
    }
  }
}
