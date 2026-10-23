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
  baseVersionCodes: readonly number[]
  platforms: readonly string[]
  architectures: readonly string[]
  distributionChannel?: string
  updateType: ReleaseUpdateType
  scope: ReleaseScope
  enabled: boolean
  mandatory: boolean
  showUpdateDialog: boolean
  policyRevision?: number
  releaseNotes?: string | null
  artifactSizeBytes?: number | null
  installerSourceUrl?: string | null
  bundleUrl?: string | null
  createdAt?: Date | string
  updatedAt?: Date | string
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
  macosUniversalArchitectures: ReadonlySet<string>
}

export type UpdateDecisionReason =
  'update-available' | 'no-enabled-release' | 'no-applicable-release'

export type UpdateSkipReason =
  | 'no_enabled_release'
  | 'application_mismatch'
  | 'platform_mismatch'
  | 'architecture_mismatch'
  | 'channel_mismatch'
  | 'audience_mismatch'
  | 'base_version_mismatch'
  | 'already_current'

export type UpdateDecision = {
  release: Release | null
  mandatory: boolean
  showUpdateDialog: boolean
  reason: UpdateDecisionReason
  skipReason?: UpdateSkipReason
  revision: number
}

export const defaultApplicationUpdatePolicy: ApplicationUpdatePolicy = {
  macosUniversalArchitectures: new Set(['arm64', 'x64'])
}
