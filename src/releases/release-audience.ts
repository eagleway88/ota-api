import { ReleaseScope } from '@/contracts/releases'
import { userIdMatchesContext } from '@/contracts/user-id'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'
import { BadRequestException } from '@nestjs/common'

export type ReleaseAudienceInput = {
  appName: string
  platforms: readonly string[]
  releaseScope?: ReleaseScope
  userIds?: readonly string[]
}

export type NormalizedReleaseAudience = {
  releaseScope: ReleaseScope
  userIds: string[]
}

export function normalizeReleaseAudience(
  input: ReleaseAudienceInput
): NormalizedReleaseAudience {
  const releaseScope = input.releaseScope ?? 'public'
  if (
    input.userIds !== undefined &&
    (!Array.isArray(input.userIds) ||
      !input.userIds.every(v => typeof v === 'string'))
  )
    throw new BadRequestException('userIds must be an array of strings')
  const parsedUserIds = input.userIds ?? []
  if (parsedUserIds.length > MAX_RELEASE_USERS) {
    throw new BadRequestException(
      `userIds cannot exceed ${MAX_RELEASE_USERS} entries`
    )
  }
  const userIds = Array.from(
    new Set(parsedUserIds.map(userId => userId.trim()))
  )
  if (userIds.some(userId => !userId || userId.length > 191)) {
    throw new Error('userIds contain an empty or overlong identifier')
  }
  if (releaseScope === 'public' && userIds.length) {
    throw new Error('public releases cannot contain userIds')
  }

  const platforms = new Set(input.platforms)
  for (const userId of userIds) {
    const matches = Array.from(platforms).some(platform =>
      userIdMatchesContext(userId, input.appName, platform)
    )
    if (!matches) {
      throw new Error(
        `userId does not match release application or platform: ${userId}`
      )
    }
  }

  return { releaseScope, userIds }
}
