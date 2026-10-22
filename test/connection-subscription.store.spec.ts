import { ConnectionSubscriptionStore } from '@/realtime/subscriptions/connection-subscription.store'

describe('ConnectionSubscriptionStore', () => {
  it('keeps application contexts independent and filters userIds exactly', () => {
    const store = new ConnectionSubscriptionStore()
    store.connect('socket-1')
    store.subscribeUserId('socket-1', 'eagleway-network:windows:1')
    store.subscribeUserId('socket-1', 'eagleway-network:ios:1')
    store.subscribeUserId('socket-1', 'other:windows:1')
    store.subscribeApplication('socket-1', {
      appName: 'eagleway-network',
      platform: 'windows',
      architecture: 'x64',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    })

    expect(
      Array.from(
        store.getApplicationSubscriber('socket-1', 'eagleway-network')!.userIds
      )
    ).toEqual(['eagleway-network:windows:1'])
  })

  it('invalidates an in-flight subscriber snapshot when identity changes', () => {
    const store = new ConnectionSubscriptionStore()
    const subscriber = store.subscribeApplication('socket-1', {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    })

    store.subscribeUserId('socket-1', 'app:windows:1')
    expect(store.isCurrent(subscriber)).toBe(false)
  })

  it('removes reverse indexes on disconnect', () => {
    const store = new ConnectionSubscriptionStore()
    store.subscribeUserId('socket-1', 'app:windows:1')
    store.subscribeApplication('socket-1', {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    })

    store.disconnect('socket-1')
    expect(store.getApplicationSubscribers('app')).toEqual([])
    expect(store.getSubscribedUserIds()).toEqual([])
  })

  it('never reuses a revision after unsubscribe and context replacement', () => {
    const store = new ConnectionSubscriptionStore()
    const input = {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    }
    const old = store.subscribeApplication('socket-1', input)
    store.unsubscribeApplication('socket-1', 'app')
    expect(store.isCurrent(old)).toBe(false)
    const next = store.subscribeApplication('socket-1', {
      ...input,
      platform: 'ios',
      nativeVersionCode: 200
    })
    expect(next.generation).toBe(old.generation)
    expect(next.application.revision).toBeGreaterThan(old.application.revision)
    expect(store.isCurrent(old)).toBe(false)
    expect(store.isCurrent(next)).toBe(true)
  })

  it('keeps identity revisions and re-subscription revisions monotonically increasing', () => {
    const store = new ConnectionSubscriptionStore()
    const input = {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    }
    const first = store.subscribeApplication('socket-1', input)
    store.subscribeUserId('socket-1', 'app:windows:1')
    const identified = store.getApplicationSubscriber('socket-1', 'app')!
    store.unsubscribeUserId('socket-1', 'app:windows:1')
    const anonymous = store.getApplicationSubscriber('socket-1', 'app')!
    store.unsubscribeApplication('socket-1', 'app')
    const next = store.subscribeApplication('socket-1', input)
    expect(
      [first, identified, anonymous].every(
        snapshot => !store.isCurrent(snapshot)
      )
    ).toBe(true)
    expect(next.application.revision).toBeGreaterThan(
      anonymous.application.revision
    )
    expect(next.userIds.size).toBe(0)
    expect(store.isCurrent(next)).toBe(true)
  })

  it('rejects snapshots from a previous connection with the same socket ID', () => {
    const store = new ConnectionSubscriptionStore()
    const input = {
      appName: 'app',
      platform: 'windows',
      nativeVersionCode: 100,
      installedReleaseSequence: 0
    }
    const old = store.subscribeApplication('socket-1', input)
    store.disconnect('socket-1')
    const next = store.subscribeApplication('socket-1', input)
    expect(next.generation).not.toBe(old.generation)
    expect(store.isCurrent(old)).toBe(false)
    expect(store.isCurrent(next)).toBe(true)
  })
})
