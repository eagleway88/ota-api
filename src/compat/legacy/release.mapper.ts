import { Release } from '@/contracts/releases'
import { mapStoredReleaseRecord } from '@/releases/release-record.mapper'

export const mapLegacyReleaseRecord = mapStoredReleaseRecord

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
