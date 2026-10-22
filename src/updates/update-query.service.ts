import { Injectable } from '@nestjs/common'
import {
  ClientUpdateContext,
  defaultApplicationUpdatePolicy
} from '@/contracts/releases'
import { resolveUpdate } from '@/updates/decision/resolve-update'
import {
  ReleaseCatalog,
  ReleaseCatalogService
} from '@/updates/catalog/release-catalog.service'
import { serializeRelease } from '@/releases/release-record.mapper'
export type { ReleaseCatalog } from '@/updates/catalog/release-catalog.service'

export type UpdateQuery = {
  appName: string
  platform: string
  architecture?: string
  distributionChannel?: string
  nativeVersionCode: number
  installedReleaseSequence?: number
  userIds?: readonly string[]
}

@Injectable()
export class UpdateQueryService {
  constructor(private readonly catalog: ReleaseCatalogService) {}

  async findLatestAvailableVersion(query: UpdateQuery) {
    if (!query.appName || !query.platform || query.nativeVersionCode == null) {
      return null
    }

    const catalog = await this.loadCatalog(query.appName)
    return this.resolveAvailableVersion(query, catalog)
  }

  invalidate(appName: string) {
    this.catalog.invalidate(appName)
  }

  loadCatalog(appName: string, force = false) {
    return this.catalog.loadCatalog(appName, force)
  }

  resolveAvailableVersion(
    query: UpdateQuery,
    catalog: ReleaseCatalog
  ): Record<string, unknown> | null {
    return this.resolveAvailableDecision(query, catalog).payload
  }

  resolveAvailableDecision(query: UpdateQuery, catalog: ReleaseCatalog) {
    const context: ClientUpdateContext = {
      appName: query.appName,
      platform: query.platform,
      architecture: query.architecture,
      distributionChannel: query.distributionChannel,
      nativeVersionCode: query.nativeVersionCode,
      installedReleaseSequence: query.installedReleaseSequence ?? 0,
      userIds: new Set(query.userIds ?? [])
    }
    const decision = resolveUpdate(
      context,
      catalog.available,
      catalog.audience,
      defaultApplicationUpdatePolicy
    )

    const payload = decision.release
      ? serializeRelease(
          decision.release,
          decision.mandatory,
          decision.showUpdateDialog
        )
      : null
    return { payload, decision }
  }
}
