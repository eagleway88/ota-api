import {
  ClientUpdateContext,
  Release,
  defaultApplicationUpdatePolicy
} from '@/contracts/releases'
import { resolveUpdate } from './resolve-update'

describe('resolveUpdate load baseline', () => {
  it('evaluates ten thousand contexts from one immutable snapshot', () => {
    const releases: Release[] = Array.from({ length: 100 }, (_, index) => ({
      releaseId: `release-${index}`,
      releaseSequence: 2000 + index,
      appName: 'app',
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
      legacyPayload: {}
    }))
    const available = { revision: 1, releases }
    const audience = { revision: 1, userIdsByReleaseId: new Map() }
    let selected = 0

    for (let index = 0; index < 10_000; index += 1) {
      const context: ClientUpdateContext = {
        appName: 'app',
        platform: 'windows',
        architecture: 'x64',
        distributionChannel: 'stable',
        nativeVersionCode: 100,
        installedReleaseSequence: index % 2 ? 0 : 2099,
        userIds: new Set()
      }
      if (
        resolveUpdate(
          context,
          available,
          audience,
          defaultApplicationUpdatePolicy
        ).release
      ) {
        selected += 1
      }
    }

    expect(selected).toBe(5_000)
  })
})
