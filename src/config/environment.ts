type RuntimeConfig = Record<string, unknown>

const requiredKeys = [
  'ORM_HOST',
  'ORM_USERNAME',
  'ORM_PASSWORD',
  'ORM_DATABASE',
  'OSS_BUCKET',
  'OSS_ACCESS_KEY_ID',
  'OSS_ACCESS_KEY_SECRET',
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

  return {
    ...config,
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
    )
  }
}
