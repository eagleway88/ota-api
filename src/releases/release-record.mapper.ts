import { Release, ReleaseScope, ReleaseUpdateType } from '@/contracts/releases'
import { underlineToHump } from '@/utils'
import { normalizeVersionValue } from '@/utils/version'

function csv(value: unknown) {
  if (Array.isArray(value)) {
    return (value as unknown[])
      .filter(
        (item): item is string | number =>
          typeof item === 'string' || typeof item === 'number'
      )
      .map(item => String(item).trim())
      .filter(Boolean)
  }
  if (typeof value !== 'string') return []
  if (value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) return csv(parsed)
    } catch {
      return []
    }
  }
  return Array.from(
    new Set(
      value
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    )
  )
}

function numberList(value: unknown) {
  return csv(value)
    .map(item => normalizeVersionValue(item))
    .filter((item): item is number => item !== undefined)
}

function booleanValue(value: unknown, defaultValue: boolean) {
  if (value === undefined || value === null) return defaultValue
  return value === true || value === 1 || value === '1'
}

function releaseUpdateType(record: Record<string, unknown>): ReleaseUpdateType {
  if (record.updateType === 'full' || record.updateType === 'hot') {
    return record.updateType
  }
  return record.installUrl ? 'full' : 'hot'
}

export function mapStoredReleaseRecord(
  record: Record<string, unknown>
): Release {
  const stored = underlineToHump(record) as unknown as Record<string, unknown>
  const rawVersion = stored.targetVersionCode ?? stored.ver
  const targetVersionCode =
    typeof rawVersion === 'string' || typeof rawVersion === 'number'
      ? (normalizeVersionValue(rawVersion) ?? 0)
      : 0
  const hasFormalBaseVersions =
    stored.compatibleBaseVersionCodes !== undefined &&
    stored.compatibleBaseVersionCodes !== null
  const compatibleBaseVersionCodes = hasFormalBaseVersions
    ? numberList(stored.compatibleBaseVersionCodes)
    : Array.from(
        new Set([targetVersionCode, ...numberList(stored.baseVersions)])
      )
  const releaseSequence = Number(stored.releaseSequence ?? stored.id)
  const releaseId =
    typeof stored.releaseId === 'string'
      ? stored.releaseId
      : `${String(stored.appName ?? stored.name)}:${String(releaseSequence)}`
  const scope: ReleaseScope =
    stored.releaseScope === 'allowlist' ? 'allowlist' : 'public'

  return {
    releaseId,
    releaseSequence,
    appName: String(stored.appName ?? stored.name),
    targetVersionCode,
    compatibleBaseVersionCodes,
    platforms: csv(stored.platforms ?? stored.platform),
    architectures: csv(stored.architectures ?? stored.architecture),
    distributionChannel:
      typeof (stored.distributionChannel ?? stored.channel) === 'string' &&
      (stored.distributionChannel ?? stored.channel)
        ? String(stored.distributionChannel ?? stored.channel)
        : undefined,
    updateType: releaseUpdateType(stored),
    scope,
    enabled: booleanValue(stored.isEnabled ?? stored.enable, true),
    mandatory: booleanValue(stored.isMandatory ?? stored.mandatory, true),
    showUpdateDialog: booleanValue(
      stored.showUpdateDialog ?? stored.showDialog,
      true
    ),
    legacyPayload: stored
  }
}
