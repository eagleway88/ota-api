import { normalizeReleaseAudience } from '@/releases/release-audience'

describe('normalizeReleaseAudience', () => {
  it('keeps omitted optional fields as a public release', () => {
    expect(
      normalizeReleaseAudience({
        appName: 'app',
        platforms: ['windows']
      })
    ).toEqual({ releaseScope: 'public', userIds: [] })
  })

  it('accepts arrays and deduplicates exact userIds', () => {
    expect(
      normalizeReleaseAudience({
        appName: 'app',
        platforms: ['windows', 'ios'],
        releaseScope: 'allowlist',
        userIds: ['app:windows:1', 'app:windows:1', 'app:ios:2']
      })
    ).toEqual({
      releaseScope: 'allowlist',
      userIds: ['app:windows:1', 'app:ios:2']
    })
  })

  it('keeps an empty allowlist private', () => {
    expect(
      normalizeReleaseAudience({
        appName: 'app',
        platforms: ['windows'],
        releaseScope: 'allowlist',
        userIds: []
      })
    ).toEqual({ releaseScope: 'allowlist', userIds: [] })
  })

  it('rejects public lists and cross-platform identifiers', () => {
    expect(() =>
      normalizeReleaseAudience({
        appName: 'app',
        platforms: ['windows'],
        userIds: ['app:windows:1']
      })
    ).toThrow('public releases cannot contain userIds')
    expect(() =>
      normalizeReleaseAudience({
        appName: 'app',
        platforms: ['windows'],
        releaseScope: 'allowlist',
        userIds: ['app:ios:1']
      })
    ).toThrow('userId does not match release application or platform')
  })
})
