import {
  ApplicationUpdatePolicy,
  AudienceSnapshot,
  AvailableReleaseSnapshot,
  ClientUpdateContext,
  Release,
  UpdateDecision
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
    return policy.legacyEmptyChannelMatchesAny
  }
  if (!context.distributionChannel) {
    return true
  }
  return release.distributionChannel === context.distributionChannel
}

function isCompatibleCandidate(
  release: Release,
  context: ClientUpdateContext,
  audience: AudienceSnapshot,
  policy: ApplicationUpdatePolicy
) {
  return (
    release.appName === context.appName &&
    release.enabled &&
    release.platforms.includes(context.platform) &&
    matchesArchitecture(release, context, policy) &&
    matchesChannel(release, context, policy) &&
    matchesAudience(release, context, audience)
  )
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
  const eligible = enabled.filter(release => {
    return isCompatibleCandidate(release, context, audience, policy)
  })

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
