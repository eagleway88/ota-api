import {
  ApplicationUpdatePolicy,
  AudienceSnapshot,
  AvailableReleaseSnapshot,
  ClientUpdateContext,
  Release,
  UpdateDecision,
  UpdateSkipReason
} from '@/contracts/releases'

function matchesAudience(
  release: Release,
  context: ClientUpdateContext,
  audience: AudienceSnapshot
) {
  if (release.scope === 'public') {
    return true
  }

  const allowedUserIds = audience.userIdsByReleaseId.get(release.releaseId)
  if (!allowedUserIds?.size || !context.userIds.size) {
    return false
  }

  for (const userId of context.userIds) {
    if (allowedUserIds.has(userId)) {
      return true
    }
  }
  return false
}

function matchesArchitecture(
  release: Release,
  context: ClientUpdateContext,
  policy: ApplicationUpdatePolicy
) {
  if (!release.architectures.length) {
    return true
  }
  if (!context.architecture) {
    return false
  }
  if (release.architectures.includes(context.architecture)) {
    return true
  }

  return (
    context.platform === 'macos' &&
    release.architectures.includes('universal') &&
    policy.macosUniversalArchitectures.has(context.architecture)
  )
}

function matchesChannel(
  release: Release,
  context: ClientUpdateContext,
  policy: ApplicationUpdatePolicy
) {
  if (!release.distributionChannel) {
    return policy.emptyChannelMatchesAny
  }
  if (!context.distributionChannel) {
    return true
  }
  return release.distributionChannel === context.distributionChannel
}

function selectFullRelease(releases: readonly Release[]) {
  return [...releases].sort((left, right) => {
    return (
      right.targetVersionCode - left.targetVersionCode ||
      right.releaseSequence - left.releaseSequence
    )
  })[0]
}

function selectHotRelease(releases: readonly Release[]) {
  return [...releases].sort((left, right) => {
    return right.releaseSequence - left.releaseSequence
  })[0]
}

export function resolveUpdate(
  context: ClientUpdateContext,
  available: AvailableReleaseSnapshot,
  audience: AudienceSnapshot,
  policy: ApplicationUpdatePolicy
): UpdateDecision {
  const enabled = available.releases.filter(release => release.enabled)
  // A single reason per connection: the first stage eliminating all candidates.
  // This diagnoses the same selection, without a second, divergent rule engine.
  const stages: Array<[UpdateSkipReason, (release: Release) => boolean]> = [
    ['application_mismatch', release => release.appName === context.appName],
    [
      'platform_mismatch',
      release => release.platforms.includes(context.platform)
    ],
    [
      'architecture_mismatch',
      release => matchesArchitecture(release, context, policy)
    ],
    ['channel_mismatch', release => matchesChannel(release, context, policy)],
    [
      'audience_mismatch',
      release => matchesAudience(release, context, audience)
    ],
    [
      'base_version_mismatch',
      release =>
        release.updateType === 'full' ||
        release.compatibleBaseVersionCodes.includes(context.nativeVersionCode)
    ]
  ]
  let eligible = enabled
  let skipReason: UpdateSkipReason = enabled.length
    ? 'already_current'
    : 'no_enabled_release'
  for (const [reason, matches] of stages) {
    if (!eligible.length) break
    eligible = eligible.filter(matches)
    if (!eligible.length) skipReason = reason
  }

  const fullCandidates = eligible.filter(release => {
    return (
      release.updateType === 'full' &&
      release.targetVersionCode > context.nativeVersionCode
    )
  })
  const hotCandidates = eligible.filter(release => {
    return (
      release.updateType === 'hot' &&
      release.releaseSequence > context.installedReleaseSequence &&
      release.compatibleBaseVersionCodes.includes(context.nativeVersionCode)
    )
  })

  const candidates = fullCandidates.length ? fullCandidates : hotCandidates
  const release = fullCandidates.length
    ? selectFullRelease(fullCandidates)
    : selectHotRelease(hotCandidates)

  if (!release) {
    return {
      release: null,
      mandatory: false,
      showUpdateDialog: false,
      reason: enabled.length ? 'no-compatible-release' : 'no-enabled-release',
      skipReason,
      revision: Math.max(available.revision, audience.revision)
    }
  }

  const mandatory = candidates.some(candidate => candidate.mandatory)
  return {
    release,
    mandatory,
    showUpdateDialog: mandatory || release.showUpdateDialog,
    reason: 'update-available',
    revision: Math.max(available.revision, audience.revision)
  }
}
