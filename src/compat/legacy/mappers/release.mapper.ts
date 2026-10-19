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
  if (typeof value !== 'string') {
    return []
  }
  if (value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (Array.isArray(parsed)) {
        return csv(parsed)
      }
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
  if (value === undefined || value === null) {
    return defaultValue
  }
  return value === true || value === 1 || value === '1'
}

function releaseUpdateType(record: Record<string, unknown>): ReleaseUpdateType {
  if (record.updateType === 'full' || record.updateType === 'hot') {
    return record.updateType
  }
  return record.installUrl ? 'full' : 'hot'
}

export function mapLegacyReleaseRecord(
  record: Record<string, unknown>
): Release {
  const legacy = underlineToHump(record) as unknown as Record<string, unknown>
  const rawVersion = legacy.targetVersionCode ?? legacy.ver
  const targetVersionCode =
    typeof rawVersion === 'string' || typeof rawVersion === 'number'
      ? (normalizeVersionValue(rawVersion) ?? 0)
      : 0
  const hasFormalBaseVersions =
    legacy.compatibleBaseVersionCodes !== undefined &&
    legacy.compatibleBaseVersionCodes !== null
  const compatibleBaseVersionCodes = hasFormalBaseVersions
    ? numberList(legacy.compatibleBaseVersionCodes)
    : Array.from(
        new Set([targetVersionCode, ...numberList(legacy.baseVersions)])
      )
  const releaseSequence = Number(legacy.releaseSequence ?? legacy.id)

  const releaseId =
    typeof legacy.releaseId === 'string'
      ? legacy.releaseId
      : `${String(legacy.appName ?? legacy.name)}:${String(releaseSequence)}`
  const scope: ReleaseScope =
    legacy.releaseScope === 'allowlist' ? 'allowlist' : 'public'

  return {
    releaseId,
    releaseSequence,
    appName: String(legacy.appName ?? legacy.name),
    targetVersionCode,
    compatibleBaseVersionCodes,
    platforms: csv(legacy.platforms ?? legacy.platform),
    architectures: csv(legacy.architectures ?? legacy.architecture),
    distributionChannel:
      typeof (legacy.distributionChannel ?? legacy.channel) === 'string' &&
      (legacy.distributionChannel ?? legacy.channel)
        ? String(legacy.distributionChannel ?? legacy.channel)
        : undefined,
    updateType: releaseUpdateType(legacy),
    scope,
    enabled: booleanValue(legacy.isEnabled ?? legacy.enable, true),
    mandatory: booleanValue(legacy.isMandatory ?? legacy.mandatory, true),
    showUpdateDialog: booleanValue(
      legacy.showUpdateDialog ?? legacy.showDialog,
      true
    ),
    legacyPayload: legacy
  }
}

const legacyReleaseFields = [
  'id',
  'ver',
  'baseVersions',
  'name',
  'platform',
  'architecture',
  'desc',
  'fileSize',
  'enable',
  'mandatory',
  'showDialog',
  'installUrl',
  'packageUrl',
  'channel',
  'updateType',
  'ip',
  'createTime',
  'updateTime'
] as const

export function serializeLegacyRelease(
  release: Release,
  mandatory: boolean,
  showUpdateDialog: boolean
) {
  const result = serializeLegacyReleaseRecord(release.legacyPayload)
  const mandatoryFlag = mandatory ? 1 : 0
  result.mandatory = mandatoryFlag
  result.showDialog = showUpdateDialog ? 1 : 0
  result.type = release.updateType === 'full' ? 1 : 0
  result.downloadUrl =
    release.updateType === 'full' ? result.installUrl : result.packageUrl
  result.isMandatory = mandatoryFlag
  return result
}

export function serializeLegacyReleaseRecord(record: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const field of legacyReleaseFields) {
    if (record[field] !== undefined) {
      result[field] = record[field]
    }
  }
  return result
}
