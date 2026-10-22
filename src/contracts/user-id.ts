export type ParsedUserId = {
  appName: string
  platform: string
  businessUserId: string
}

export function parseUserId(value: unknown): ParsedUserId | null {
  if (typeof value !== 'string' || value.length > 191) return null
  const firstSeparator = value.indexOf(':')
  const secondSeparator = value.indexOf(':', firstSeparator + 1)
  if (firstSeparator <= 0 || secondSeparator <= firstSeparator + 1) {
    return null
  }

  const businessUserId = value.slice(secondSeparator + 1)
  if (!businessUserId) {
    return null
  }

  return {
    appName: value.slice(0, firstSeparator),
    platform: value.slice(firstSeparator + 1, secondSeparator),
    businessUserId
  }
}

export function userIdMatchesContext(
  value: string,
  appName: string,
  platform: string
) {
  const parsed = parseUserId(value)
  return parsed?.appName === appName && parsed.platform === platform
}
