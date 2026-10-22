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
import { serializeLegacyRelease } from '@/compat/legacy/release.mapper'
export type { ReleaseCatalog } from '@/updates/catalog/release-catalog.service'

export type OtaVersionQuery = {
  name: string
  platform: string
  architecture?: string
  channel?: string
  ver: number
  id?: number
  userIds?: readonly string[]
}

@Injectable()
export class UpdateQueryService {
  constructor(private readonly catalog: ReleaseCatalogService) {}

  async findLatestAvailableVersion(query: OtaVersionQuery) {
    if (!query.name || !query.platform || query.ver == null) {
      return null
    }

    const catalog = await this.loadCatalog(query.name)
    return this.resolveAvailableVersion(query, catalog)
  }

  invalidate(appName: string) {
    this.catalog.invalidate(appName)
  }

  loadCatalog(appName: string, force = false) {
    return this.catalog.loadCatalog(appName, force)
  }

  resolveAvailableVersion(
    query: OtaVersionQuery,
    catalog: ReleaseCatalog
  ): Record<string, unknown> | null {
    return this.resolveAvailableDecision(query, catalog).payload
  }

  resolveAvailableDecision(query: OtaVersionQuery, catalog: ReleaseCatalog) {
    const context: ClientUpdateContext = {
      appName: query.name,
      platform: query.platform,
      architecture: query.architecture,
      distributionChannel: query.channel,
      nativeVersionCode: query.ver,
      installedReleaseSequence: query.id ?? 0,
      userIds: new Set(query.userIds ?? [])
    }
    const decision = resolveUpdate(
      context,
      catalog.available,
      catalog.audience,
      defaultApplicationUpdatePolicy
    )

    const payload = decision.release
      ? serializeLegacyRelease(
          decision.release,
          decision.mandatory,
          decision.showUpdateDialog
        )
      : null
    return { payload, decision }
  }
}
