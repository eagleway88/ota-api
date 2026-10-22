import { validateRuntimeConfig } from '@/config/environment'

const valid = {
  ORM_HOST: '127.0.0.1',
  ORM_USERNAME: 'ota',
  ORM_PASSWORD: 'secret',
  ORM_DATABASE: 'ota',
  JWT_SECRET: 'jwt-secret',
  OSS_BUCKER: 'bucket',
  OSS_KEY: 'key',
  OSS_SECRET: 'oss-secret',
  OSS_REGION: 'region'
}

describe('validateRuntimeConfig', () => {
  it('normalizes numeric defaults', () => {
    expect(validateRuntimeConfig(valid)).toEqual(
      expect.objectContaining({
        PORT: 3001,
        ORM_PORT: 3306,
        TRUST_PROXY_HOPS: 1,
        MESSAGE_RESEND_TTL_SECONDS: 86400
      })
    )
  })

  it('bounds administrator token lifetime and initialization secrets', () => {
    expect(validateRuntimeConfig(valid).ADMIN_ACCESS_TOKEN_TTL_SECONDS).toBe(
      3600
    )
    for (const seconds of [0, 59, 86401, 1.5]) {
      expect(() =>
        validateRuntimeConfig({
          ...valid,
          ADMIN_ACCESS_TOKEN_TTL_SECONDS: seconds
        })
      ).toThrow('ADMIN_ACCESS_TOKEN_TTL_SECONDS')
    }
    expect(() =>
      validateRuntimeConfig({ ...valid, ADMIN_INITIALIZATION_TOKEN: 'short' })
    ).toThrow('ADMIN_INITIALIZATION_TOKEN')
    expect(() =>
      validateRuntimeConfig({ ...valid, ADMIN_INITIALIZATION_TOKEN: '' })
    ).not.toThrow()
  })

  it('rejects missing secrets and invalid limits', () => {
    expect(() => validateRuntimeConfig({ ...valid, JWT_SECRET: '' })).toThrow(
      'JWT_SECRET is required'
    )
    expect(() =>
      validateRuntimeConfig({ ...valid, OTA_UPLOAD_MAX_BYTES: '0' })
    ).toThrow('OTA_UPLOAD_MAX_BYTES must be a positive integer')
  })
})
