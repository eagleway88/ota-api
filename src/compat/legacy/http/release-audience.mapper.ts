import { ReleaseScope } from '@/contracts/releases'
import { userIdMatchesContext } from '@/contracts/user-id'

export type LegacyReleaseAudienceInput = {
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
  if (value === undefined) {
    return []
  }
  if (typeof value !== 'string') {
    return [...value]
  }

  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      throw new Error()
    }
    const parsedItems: unknown[] = parsed
    if (!parsedItems.every(item => typeof item === 'string')) {
      throw new Error()
    }
    return parsedItems.filter(
      (item): item is string => typeof item === 'string'
    )
  } catch {
    throw new Error('userIds must be a JSON string array')
  }
}

export function normalizeLegacyReleaseAudience(
  input: LegacyReleaseAudienceInput
): NormalizedReleaseAudience {
  const releaseScope = input.releaseScope ?? 'public'
  const userIds = Array.from(
    new Set(parseUserIds(input.userIds).map(userId => userId.trim()))
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
    const matches = Array.from(platforms).some(platform => {
      return userIdMatchesContext(userId, input.appName, platform)
    })
    if (!matches) {
      throw new Error(
        `userId does not match release application or platform: ${userId}`
      )
    }
  }

  return { releaseScope, userIds }
}
