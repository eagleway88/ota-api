import { validateRuntimeConfig } from '@/config/environment'

const valid = {
  ORM_HOST: '127.0.0.1',
  ORM_USERNAME: 'ota',
  ORM_PASSWORD: 'secret',
  ORM_DATABASE: 'ota',
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

  it('does not require login, JWT or initialization configuration for a headless API service', () => {
    expect(() => validateRuntimeConfig(valid)).not.toThrow()
  })

  it('rejects missing secrets and invalid limits', () => {
    expect(() => validateRuntimeConfig({ ...valid, ORM_PASSWORD: '' })).toThrow(
      'ORM_PASSWORD is required'
    )
    expect(() =>
      validateRuntimeConfig({ ...valid, OTA_UPLOAD_MAX_BYTES: '0' })
    ).toThrow('OTA_UPLOAD_MAX_BYTES must be a positive integer')
  })
})
