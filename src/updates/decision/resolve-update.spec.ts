import {
  AudienceSnapshot,
  ClientUpdateContext,
  Release,
  defaultApplicationUpdatePolicy
} from '@/contracts/releases'
import { resolveUpdate } from './resolve-update'

function release(overrides: Partial<Release> = {}): Release {
  return {
    releaseId: 'release-1',
    releaseSequence: 2000,
    appName: 'eagleway-network',
    targetVersionCode: 110,
    compatibleBaseVersionCodes: [100],
    platforms: ['windows'],
    architectures: ['x64'],
    distributionChannel: 'stable',
    updateType: 'hot',
    scope: 'public',
    enabled: true,
    mandatory: false,
    showUpdateDialog: true,
    legacyPayload: {},
    ...overrides
  }
}

function context(overrides: Partial<ClientUpdateContext> = {}) {
  return {
    appName: 'eagleway-network',
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
  it('does not send a hot update to an incompatible native version', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 1,
        releases: [release({ compatibleBaseVersionCodes: [110] })]
      },
      audience(),
      defaultApplicationUpdatePolicy
    )

    expect(decision.release).toBeNull()
    expect(decision.reason).toBe('no-compatible-release')
  })

  it('selects an older public candidate when the latest private release is not allowed', () => {
    const decision = resolveUpdate(
      context(),
      {
        revision: 2,
        releases: [
          release({
            releaseId: 'private',
            releaseSequence: 2002,
            scope: 'allowlist'
          }),
          release({ releaseId: 'public', releaseSequence: 2001 })
        ]
      },
      audience([['private', ['eagleway-network:windows:2']]]),
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
            releaseSequence: 2002,
            scope: 'allowlist',
            mandatory: true
          }),
          release({
            releaseId: 'public',
            releaseSequence: 2001,
            mandatory: false
          })
        ]
      },
      audience([['private', ['eagleway-network:windows:2']]]),
      defaultApplicationUpdatePolicy
    )

    expect(decision.mandatory).toBe(false)
  })

  it('accepts a private release for an exact full userId match', () => {
    const userId = 'eagleway-network:windows:1'
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
})
