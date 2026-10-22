type RuntimeConfig = Record<string, unknown>

const requiredKeys = [
  'ORM_HOST',
  'ORM_USERNAME',
  'ORM_PASSWORD',
  'ORM_DATABASE',
  'JWT_SECRET',
  'OSS_BUCKER',
  'OSS_KEY',
  'OSS_SECRET',
  'OSS_REGION'
] as const

function positiveInteger(value: unknown, name: string, fallback?: number) {
  if ((value === undefined || value === '') && fallback !== undefined) {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`)
  }
  return parsed
}

function nonNegativeInteger(value: unknown, name: string, fallback: number) {
  if (value === undefined || value === '') {
    return fallback
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`)
  }
  return parsed
}

export function validateRuntimeConfig(config: RuntimeConfig) {
  for (const key of requiredKeys) {
    if (typeof config[key] !== 'string' || !config[key].trim()) {
      throw new Error(`${key} is required`)
    }
  }

  const tokenLifetime = positiveInteger(
    config.ADMIN_ACCESS_TOKEN_TTL_SECONDS,
    'ADMIN_ACCESS_TOKEN_TTL_SECONDS',
    3600
  )
  if (tokenLifetime < 60 || tokenLifetime > 86400) {
    throw new Error(
      'ADMIN_ACCESS_TOKEN_TTL_SECONDS must be between 60 and 86400'
    )
  }
  const initializationToken = config.ADMIN_INITIALIZATION_TOKEN
  if (
    initializationToken !== undefined &&
    initializationToken !== '' &&
    (typeof initializationToken !== 'string' ||
      initializationToken.length < 32 ||
      initializationToken.length > 1024)
  ) {
    throw new Error(
      'ADMIN_INITIALIZATION_TOKEN must be 32–1024 characters or unset'
    )
  }

  return {
    ...config,
    ADMIN_ACCESS_TOKEN_TTL_SECONDS: tokenLifetime,
    PORT: positiveInteger(config.PORT, 'PORT', 3001),
    ORM_PORT: positiveInteger(config.ORM_PORT, 'ORM_PORT', 3306),
    OTA_UPLOAD_MAX_BYTES: positiveInteger(
      config.OTA_UPLOAD_MAX_BYTES,
      'OTA_UPLOAD_MAX_BYTES',
      100 * 1024 * 1024
    ),
    MESSAGE_RESEND_TTL_SECONDS: positiveInteger(
      config.MESSAGE_RESEND_TTL_SECONDS,
      'MESSAGE_RESEND_TTL_SECONDS',
      86400
    ),
    TRUST_PROXY_HOPS: nonNegativeInteger(
      config.TRUST_PROXY_HOPS,
      'TRUST_PROXY_HOPS',
      1
    ),
    PUBLISH_TASK_POLL_MS: positiveInteger(
      config.PUBLISH_TASK_POLL_MS,
      'PUBLISH_TASK_POLL_MS',
      5000
    ),
    TASK_RETENTION_DAYS: positiveInteger(
      config.TASK_RETENTION_DAYS,
      'TASK_RETENTION_DAYS',
      90
    ),
    AUDIT_RETENTION_DAYS: positiveInteger(
      config.AUDIT_RETENTION_DAYS,
      'AUDIT_RETENTION_DAYS',
      180
    )
  }
}
