import {
  AudienceSnapshot,
  ClientUpdateContext,
  Release,
  defaultApplicationUpdatePolicy
} from '@/contracts/releases'
import { resolveUpdate } from '@/updates/decision/resolve-update'

function release(overrides: Partial<Release> = {}): Release {
  return {
    releaseId: 'release-1',
    releaseSequence: 1,
    appName: 'sample-app',
    targetVersionCode: 110,
    baseVersionCodes: [100],
    platforms: ['windows'],
    architectures: ['x64'],
    distributionChannel: 'stable',
    updateType: 'hot',
    scope: 'public',
    enabled: true,
    mandatory: false,
    showUpdateDialog: true,

    ...overrides
  }
}

function context(overrides: Partial<ClientUpdateContext> = {}) {
  return {
    appName: 'sample-app',
    platform: 'windows',
    architecture: 'x64',
    distributionChannel: 'stable',
    nativeVersionCode: 100,
    installedReleaseSequence: 0,
    userIds: new Set<string>(),
    ...overrides
  }
}

function audience(entries: [string, string[]][] = []): AudienceSnapshot {
  return {
    revision: 1,
    userIdsByReleaseId: new Map(
      entries.map(([key, values]) => [key, new Set(values)])
    )
  }
}

describe('resolveUpdate', () => {
  it.each([
    ['no_enabled_release', { enabled: false }],
    ['application_mismatch', { appName: 'other' }],
    ['platform_mismatch', { platforms: ['linux'] }],
    ['architecture_mismatch', { architectures: ['arm64'] }],
    ['channel_mismatch', { distributionChannel: 'beta' }],
    ['audience_mismatch', { scope: 'allowlist' }],
    ['base_version_mismatch', { baseVersionCodes: [999] }],
    ['already_current', { updateType: 'full', targetVersionCode: 100 }]
  ] as Array<[string, Partial<Release>]>)(
    'diagnoses %s from the same selection rules',
    (reason, overrides) => {
      const decision = resolveUpdate(
        context(),
        { revision: 1, releases: [release(overrides)] },
        audience(),
        defaultApplicationUpdatePolicy
      )
      expect(decision.release).toBeNull()
      expect(decision.skipReason).toBe(reason)
    }
  )

  it('does not send a hot update outside its base-version set', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 1,
        releases: [release({ baseVersionCodes: [110] })]
      },
      audience(),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release).toBeNull()
    expect(decision.reason).toBe('no-applicable-release')
  })

  it('selects an older public candidate when the latest private release is not allowed', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 2,
        releases: [
          release({
            releaseId: 'private',
            releaseSequence: 3,
            scope: 'allowlist'
          }),
          release({ releaseId: 'public', releaseSequence: 2 })
        ]
      },
      audience([['private', ['sample-app:windows:2']]]),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release?.releaseId).toBe('public')
  })

  it('only calculates mandatory from candidates visible to this client', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 2,
        releases: [
          release({
            releaseId: 'private',
            releaseSequence: 3,
            scope: 'allowlist',
            mandatory: true
          }),
          release({
            releaseId: 'public',
            releaseSequence: 2,
            mandatory: false
          })
        ]
      },
      audience([['private', ['sample-app:windows:2']]]),
      defaultApplicationUpdatePolicy
    )

    expect(decision.mandatory).toBe(false)
  })

  it('accepts a private release for an exact full userId match', () => {
    const userId = 'sample-app:windows:1'
    const decision = resolveUpdate(
      context({ userIds: new Set([userId]) }),
      {
        revision: 2,
        releases: [release({ releaseId: 'private', scope: 'allowlist' })]
      },
      audience([['private', [userId]]]),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release?.releaseId).toBe('private')
  })

  it('prefers an applicable full update over a newer hot update', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 1,
        releases: [
          release({ releaseId: 'hot', releaseSequence: 2200 }),
          release({
            releaseId: 'full',
            releaseSequence: 2100,
            updateType: 'full',
            targetVersionCode: 120
          })
        ]
      },
      audience(),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release?.releaseId).toBe('full')
  })

  it.each([
    ['application', release({ appName: 'other-app' })],
    ['platform', release({ platforms: ['linux'] })],
    ['architecture', release({ architectures: ['arm64'] })],
    ['channel', release({ distributionChannel: 'beta' })]
  ])('rejects a release with a mismatched %s', (_, candidate) => {
    const decision = resolveUpdate(
      context(),
      { revision: 1, releases: [candidate] },
      audience(),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release).toBeNull()
  })

  it('requires an explicit matching client channel for channel-scoped releases', () => {
    const decision = resolveUpdate(
      context({ distributionChannel: undefined }),
      { revision: 1, releases: [release({ distributionChannel: 'beta' })] },
      audience(),
      defaultApplicationUpdatePolicy
    )
    expect(decision.release).toBeNull()
    expect(decision.skipReason).toBe('channel_mismatch')
  })
  it('allows releases without a channel constraint for any client channel', () => {
    const decision = resolveUpdate(
      context({ distributionChannel: 'beta' }),
      { revision: 1, releases: [release({ distributionChannel: undefined })] },
      audience(),
      defaultApplicationUpdatePolicy
    )
    expect(decision.release?.releaseId).toBe('release-1')
  })
  it.each(['arm64', 'x64'])(
    'matches a macOS universal release to %s clients',
    architecture => {
      const decision = resolveUpdate(
        context({ platform: 'macos', architecture }),
        {
          revision: 1,
          releases: [
            release({
              platforms: ['macos'],
              architectures: ['universal']
            })
          ]
        },
        audience(),
        defaultApplicationUpdatePolicy
      )

      expect(decision.release?.releaseId).toBe('release-1')
    }
  )

  it('does not expose a release with an empty allowlist', () => {
    const decision = resolveUpdate(
      context({ userIds: new Set(['sample-app:windows:1']) }),
      {
        revision: 1,
        releases: [release({ scope: 'allowlist' })]
      },
      audience([['release-1', []]]),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release).toBeNull()
  })

  it('does not resend an installed hot release', () => {
    const decision = resolveUpdate(
      context({ installedReleaseSequence: 1 }),
      { revision: 1, releases: [release()] },
      audience(),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release).toBeNull()
  })
})
