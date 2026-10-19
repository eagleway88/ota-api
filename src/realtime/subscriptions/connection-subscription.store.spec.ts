import { ConnectionSubscriptionStore } from './connection-subscription.store'

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
})
