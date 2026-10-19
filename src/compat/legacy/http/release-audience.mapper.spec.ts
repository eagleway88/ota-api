import { normalizeLegacyReleaseAudience } from './release-audience.mapper'

describe('normalizeLegacyReleaseAudience', () => {
  it('keeps omitted legacy fields as a public release', () => {
    expect(
      normalizeLegacyReleaseAudience({
        appName: 'app',
        platforms: 'windows'
      })
    ).toEqual({ releaseScope: 'public', userIds: [] })
  })

  it('parses multipart JSON and deduplicates exact userIds', () => {
    expect(
      normalizeLegacyReleaseAudience({
        appName: 'app',
        platforms: 'windows, ios',
        releaseScope: 'allowlist',
        userIds: '["app:windows:1","app:windows:1","app:ios:2"]'
      })
    ).toEqual({
      releaseScope: 'allowlist',
      userIds: ['app:windows:1', 'app:ios:2']
    })
  })

  it('keeps an empty allowlist private', () => {
    expect(
      normalizeLegacyReleaseAudience({
        appName: 'app',
        platforms: 'windows',
        releaseScope: 'allowlist',
        userIds: []
      })
    ).toEqual({ releaseScope: 'allowlist', userIds: [] })
  })

  it('rejects public lists and cross-platform identifiers', () => {
    expect(() =>
      normalizeLegacyReleaseAudience({
        appName: 'app',
        platforms: 'windows',
        userIds: ['app:windows:1']
      })
    ).toThrow('public releases cannot contain userIds')
    expect(() =>
      normalizeLegacyReleaseAudience({
        appName: 'app',
        platforms: 'windows',
        releaseScope: 'allowlist',
        userIds: ['app:ios:1']
      })
    ).toThrow('userId does not match release application or platform')
  })
})
