import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { DataSource } from 'typeorm'
import { AuthService } from '@/auth/auth.service'

describe('administrator initialization gate', () => {
  const service = (token?: string) =>
    new AuthService(
      new JwtService(),
      new ConfigService({ ADMIN_INITIALIZATION_TOKEN: token }),
      {} as DataSource
    )

  it.each([undefined, '', 'short'])(
    'disables initialization without a strong configured token: %s',
    token => {
      expect(() => service(token).assertInitializationToken(token)).toThrow(
        'disabled or unauthorized'
      )
    }
  )

  it('compares exact tokens, rejects missing or invalid tokens and accepts the configured secret', () => {
    const secret = 'isolated-test-initialization-secret'
    for (const token of [
      undefined,
      '',
      'x'.repeat(secret.length),
      'x'.repeat(1025)
    ]) {
      expect(() => service(secret).assertInitializationToken(token)).toThrow(
        'disabled or unauthorized'
      )
    }
    expect(() =>
      service(secret).assertInitializationToken(secret)
    ).not.toThrow()
  })
})
