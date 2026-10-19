export type ReleaseScope = 'public' | 'allowlist'

export type ReleaseUpdateType = 'full' | 'hot'

export type ClientUpdateContext = {
  appName: string
  platform: string
  architecture?: string
  distributionChannel?: string
  nativeVersionCode: number
  installedReleaseSequence: number
  userIds: ReadonlySet<string>
}

export type Release = {
  releaseId: string
  releaseSequence: number
  appName: string
  targetVersionCode: number
  compatibleBaseVersionCodes: readonly number[]
  platforms: readonly string[]
  architectures: readonly string[]
  distributionChannel?: string
  updateType: ReleaseUpdateType
  scope: ReleaseScope
  enabled: boolean
  mandatory: boolean
  showUpdateDialog: boolean
  legacyPayload: Record<string, unknown>
}

export type AvailableReleaseSnapshot = {
  revision: number
  releases: readonly Release[]
}

export type AudienceSnapshot = {
  revision: number
  userIdsByReleaseId: ReadonlyMap<string, ReadonlySet<string>>
}

export type ApplicationUpdatePolicy = {
  legacyEmptyChannelMatchesAny: boolean
  macosUniversalArchitectures: ReadonlySet<string>
}

export type UpdateDecisionReason =
  'update-available' | 'no-enabled-release' | 'no-compatible-release'

export type UpdateDecision = {
  release: Release | null
  mandatory: boolean
  showUpdateDialog: boolean
  reason: UpdateDecisionReason
  revision: number
}

export const defaultApplicationUpdatePolicy: ApplicationUpdatePolicy = {
  legacyEmptyChannelMatchesAny: true,
  macosUniversalArchitectures: new Set(['arm64', 'x64'])
}
