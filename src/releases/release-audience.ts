import { ReleaseScope } from '@/contracts/releases'
import { userIdMatchesContext } from '@/contracts/user-id'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'
import { BadRequestException } from '@nestjs/common'

export type ReleaseAudienceInput = {
  appName: string
  platforms: string
  releaseScope?: ReleaseScope
  userIds?: string | readonly string[]
}

export type NormalizedReleaseAudience = {
  releaseScope: ReleaseScope
  userIds: string[]
}

function parseUserIds(value?: string | readonly string[]) {
  if (value === undefined) return []
  if (typeof value !== 'string') return [...value]
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !Array.isArray(parsed) ||
      !parsed.every(item => typeof item === 'string')
    ) {
      throw new Error()
    }
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    throw new Error('userIds must be a JSON string array')
  }
}

export function normalizeReleaseAudience(
  input: ReleaseAudienceInput
): NormalizedReleaseAudience {
  const releaseScope = input.releaseScope ?? 'public'
  const parsedUserIds = parseUserIds(input.userIds)
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

  const platforms = new Set(
    input.platforms
      .split(',')
      .map(platform => platform.trim())
      .filter(Boolean)
  )
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
