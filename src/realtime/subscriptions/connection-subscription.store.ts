import { Injectable } from '@nestjs/common'
import { userIdMatchesContext } from '@/contracts/user-id'

export type ApplicationSubscription = {
  appName: string
  platform: string
  architecture?: string
  distributionChannel?: string
  nativeVersionCode: number
  installedReleaseSequence: number
  revision: number
}

export type ApplicationSubscriber = {
  socketId: string
  generation: number
  application: ApplicationSubscription
  userIds: ReadonlySet<string>
}

type ConnectionState = {
  socketId: string
  generation: number
  nextSubscriptionRevision: number
  userIds: Set<string>
  uniqueIds: Set<string>
  applications: Map<string, ApplicationSubscription>
}

@Injectable()
export class ConnectionSubscriptionStore {
  private readonly connections = new Map<string, ConnectionState>()
  private readonly applicationSockets = new Map<string, Set<string>>()
  private readonly userIdSockets = new Map<string, Set<string>>()
  private nextGeneration = 1

  connect(socketId: string) {
    const existing = this.connections.get(socketId)
    if (existing) {
      return existing.generation
    }

    const generation = this.nextGeneration++
    this.connections.set(socketId, {
      socketId,
      generation,
      nextSubscriptionRevision: 1,
      userIds: new Set(),
      uniqueIds: new Set(),
      applications: new Map()
    })
    return generation
  }

  disconnect(socketId: string) {
    const state = this.connections.get(socketId)
    if (!state) {
      return
    }

    for (const appName of state.applications.keys()) {
      this.removeFromIndex(this.applicationSockets, appName, socketId)
    }
    for (const userId of state.userIds) {
      this.removeFromIndex(this.userIdSockets, userId, socketId)
    }
    this.connections.delete(socketId)
  }

  subscribeApplication(
    socketId: string,
    input: Omit<ApplicationSubscription, 'revision'>
  ) {
    const state = this.getOrConnect(socketId)
    // Allocate from the connection lifetime, not the removable subscription.
    const revision = state.nextSubscriptionRevision++
    const subscription = { ...input, revision }
    state.applications.set(input.appName, subscription)
    this.addToIndex(this.applicationSockets, input.appName, socketId)
    return this.toSubscriber(state, subscription)
  }

  unsubscribeApplication(socketId: string, appName: string) {
    const state = this.connections.get(socketId)
    if (!state) {
      return false
    }
    const removed = state.applications.delete(appName)
    if (removed) {
      this.removeFromIndex(this.applicationSockets, appName, socketId)
    }
    return removed
  }

  subscribeUserId(socketId: string, userId: string) {
    const state = this.getOrConnect(socketId)
    state.userIds.add(userId)
    this.addToIndex(this.userIdSockets, userId, socketId)
    this.incrementApplicationRevisions(state)
  }

  unsubscribeUserId(socketId: string, userId: string) {
    const state = this.connections.get(socketId)
    if (!state || !state.userIds.delete(userId)) {
      return
    }
    this.removeFromIndex(this.userIdSockets, userId, socketId)
    this.incrementApplicationRevisions(state)
  }

  subscribeUniqueId(socketId: string, appName: string, uniqueId: string) {
    this.getOrConnect(socketId).uniqueIds.add(
      JSON.stringify([appName, uniqueId])
    )
  }

  unsubscribeUniqueId(socketId: string, appName: string, uniqueId: string) {
    this.connections
      .get(socketId)
      ?.uniqueIds.delete(JSON.stringify([appName, uniqueId]))
  }

  hasUniqueId(socketId: string, appName: string, uniqueId: string) {
    return (
      this.connections
        .get(socketId)
        ?.uniqueIds.has(JSON.stringify([appName, uniqueId])) ?? false
    )
  }

  hasUserId(socketId: string, userId: string) {
    return this.connections.get(socketId)?.userIds.has(userId) ?? false
  }

  getApplicationSubscriber(socketId: string, appName: string) {
    const state = this.connections.get(socketId)
    const application = state?.applications.get(appName)
    return state && application
      ? this.toSubscriber(state, application)
      : undefined
  }

  getApplicationSubscribers(appName: string) {
    const socketIds = this.applicationSockets.get(appName) ?? new Set()
    const subscribers: ApplicationSubscriber[] = []
    for (const socketId of socketIds) {
      const subscriber = this.getApplicationSubscriber(socketId, appName)
      if (subscriber) {
        subscribers.push(subscriber)
      }
    }
    return subscribers
  }

  getConnectionApplications(socketId: string) {
    const state = this.connections.get(socketId)
    return state ? Array.from(state.applications.keys()) : []
  }

  getSubscribedUserIds(appName?: string) {
    const userIds = Array.from(this.userIdSockets.keys()).filter(userId => {
      return !appName || userId.startsWith(`${appName}:`)
    })
    return userIds.sort((left, right) => left.localeCompare(right))
  }

  isCurrent(subscriber: ApplicationSubscriber) {
    const current = this.connections
      .get(subscriber.socketId)
      ?.applications.get(subscriber.application.appName)
    return (
      this.connections.get(subscriber.socketId)?.generation ===
        subscriber.generation &&
      current?.revision === subscriber.application.revision
    )
  }

  private getOrConnect(socketId: string) {
    this.connect(socketId)
    return this.connections.get(socketId)!
  }

  private incrementApplicationRevisions(state: ConnectionState) {
    for (const [appName, application] of state.applications) {
      state.applications.set(appName, {
        ...application,
        revision: state.nextSubscriptionRevision++
      })
    }
  }

  private toSubscriber(
    state: ConnectionState,
    application: ApplicationSubscription
  ): ApplicationSubscriber {
    const matchingUserIds = Array.from(state.userIds).filter(userId => {
      return userIdMatchesContext(
        userId,
        application.appName,
        application.platform
      )
    })
    return {
      socketId: state.socketId,
      generation: state.generation,
      application: { ...application },
      userIds: new Set(matchingUserIds)
    }
  }

  private addToIndex(
    index: Map<string, Set<string>>,
    key: string,
    socketId: string
  ) {
    const socketIds = index.get(key) ?? new Set<string>()
    socketIds.add(socketId)
    index.set(key, socketIds)
  }

  private removeFromIndex(
    index: Map<string, Set<string>>,
    key: string,
    socketId: string
  ) {
    const socketIds = index.get(key)
    socketIds?.delete(socketId)
    if (!socketIds?.size) {
      index.delete(key)
    }
  }
}
