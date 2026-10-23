import { BadRequestException } from '@nestjs/common'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

describe('ApplicationTableResolver', () => {
  const resolver = new ApplicationTableResolver()

  it('normalizes application names without discarding digits', () => {
    expect(resolver.resolve('sample-app-123').release).toBe(
      'sample_app_123_release'
    )
  })

  it('creates a stable bounded prefix for long new applications', () => {
    const appName = `application-${'long-'.repeat(18)}name`
    const first = resolver.collisionSafePrefix(appName)
    const second = resolver.collisionSafePrefix(appName)
    expect(first).toBe(second)
    expect(first.length).toBeLessThanOrEqual(40)
  })

  it('rejects unsafe application names and prefixes', () => {
    expect(() => resolver.resolve('../app')).toThrow(BadRequestException)
    expect(() => resolver.resolve('app', 'app`; DROP TABLE x')).toThrow(
      BadRequestException
    )
  })
})
