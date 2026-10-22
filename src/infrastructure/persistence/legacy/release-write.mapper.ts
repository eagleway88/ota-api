import { BadRequestException } from '@nestjs/common'
import { ReleaseWriteInput } from '@/releases/ports/release-write.repository'
import { normalizeVersionList, normalizeVersionValue } from '@/utils/version'

export function enabledWriteValues(enabled: boolean) {
  return { enable: enabled ? 1 : 0, is_enabled: enabled ? 1 : 0 }
}

/** The only expansion from one publication model to both storage formats. */
export function dualWriteReleaseValues(input: ReleaseWriteInput) {
  if (
    !Number.isSafeInteger(input.targetVersionCode) ||
    input.targetVersionCode < 0 ||
    input.targetVersionCode > 2147483647
  )
    throw new BadRequestException('Invalid target version code')
  if (
    !input.compatibleBaseVersionCodes.every(
      value => Number.isSafeInteger(value) && value >= 0 && value <= 2147483647
    )
  )
    throw new BadRequestException('Invalid compatible base version code')
  return {
    name: input.appName,
    release_id: input.releaseId,
    release_scope: input.releaseScope,
    policy_revision: 1,
    target_version_code: input.targetVersionCode,
    ver: input.targetVersionCode,
    compatible_base_version_codes: JSON.stringify(
      input.compatibleBaseVersionCodes
    ),
    base_versions: input.compatibleBaseVersionCodes.join(','),
    platforms: JSON.stringify(input.platforms),
    platform: input.platforms.join(','),
    architectures: JSON.stringify(input.architectures),
    architecture: input.architectures.join(','),
    distribution_channel: input.distributionChannel,
    channel: input.distributionChannel,
    update_type: input.updateType,
    release_notes: input.releaseNotes,
    desc: input.releaseNotes,
    artifact_size_bytes: input.artifactSizeBytes,
    file_size: input.artifactSizeBytes,
    installer_source_url: input.installerSourceUrl,
    install_url: input.installerSourceUrl,
    bundle_url: input.bundleUrl,
    package_url: input.bundleUrl,
    ...enabledWriteValues(input.enabled),
    is_mandatory: input.mandatory ? 1 : 0,
    mandatory: input.mandatory ? 1 : 0,
    show_update_dialog: input.showUpdateDialog ? 1 : 0,
    show_dialog: input.showUpdateDialog ? 1 : 0,
    created_at: input.createdAt,
    create_time: input.createdAt,
    ip: input.sourceIp
  }
}

function text(value: unknown, field: string) {
  if (value == null) return undefined
  if (typeof value !== 'string')
    throw new BadRequestException(`Invalid legacy ${field}`)
  return value
}
function csv(value: string | undefined) {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
    )
  ]
}
function flag(value: unknown) {
  if (value == null) return true
  if (value === 1 || value === '1' || value === true) return true
  if (value === 0 || value === '0' || value === false) return false
  throw new BadRequestException('Legacy flags must be 0 or 1')
}

export function legacyReleaseWriteValues(payload: Record<string, unknown>) {
  const ver = payload.ver
  if (typeof ver !== 'number' && typeof ver !== 'string')
    throw new BadRequestException('Missing legacy version')
  const targetVersionCode = normalizeVersionValue(ver)
  if (targetVersionCode === undefined)
    throw new BadRequestException('Invalid legacy version')
  const baseVersions = normalizeVersionList(
    text(payload.baseVersions, 'baseVersions')
  )
  const platform = text(payload.platform, 'platform')
  const architecture = text(payload.architecture, 'architecture')
  const appName = text(payload.name, 'name')
  const releaseId = text(payload.releaseId, 'releaseId')
  if (
    !appName ||
    !releaseId ||
    !platform ||
    !(payload.createTime instanceof Date)
  )
    throw new BadRequestException(
      'Missing publication identity, platform or timestamp'
    )
  if (payload.releaseScope !== 'public' && payload.releaseScope !== 'allowlist')
    throw new BadRequestException('Invalid release scope')
  if (payload.updateType !== 'full' && payload.updateType !== 'hot')
    throw new BadRequestException('Invalid update type')
  const input: ReleaseWriteInput = {
    appName,
    releaseId,
    targetVersionCode,
    compatibleBaseVersionCodes: [
      ...new Set([targetVersionCode, ...csv(baseVersions).map(Number)])
    ],
    platforms: csv(platform),
    architectures: csv(architecture),
    distributionChannel: text(payload.channel, 'channel'),
    releaseNotes: text(payload.desc, 'desc'),
    artifactSizeBytes:
      payload.fileSize == null ? undefined : Number(payload.fileSize),
    installerSourceUrl: text(payload.installUrl, 'installUrl'),
    bundleUrl: text(payload.packageUrl, 'packageUrl'),
    enabled: flag(payload.enable),
    mandatory: flag(payload.mandatory),
    showUpdateDialog: flag(payload.showDialog),
    updateType: payload.updateType,
    releaseScope: payload.releaseScope,
    createdAt: payload.createTime,
    sourceIp: text(payload.ip, 'ip')
  }
  const values = dualWriteReleaseValues(input)
  // Keep the old wire representation: its CSV omits the implicit target union.
  // Explicit NULL flags have the historical default-true meaning but remain NULL on the old wire.
  return {
    ...values,
    base_versions: baseVersions ?? null,
    platform,
    architecture: architecture ?? null,
    ...(payload.enable === null ? { enable: null } : {}),
    ...(payload.mandatory === null ? { mandatory: null } : {}),
    ...(payload.showDialog === null ? { show_dialog: null } : {})
  }
}
