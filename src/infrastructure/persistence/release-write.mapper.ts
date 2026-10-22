import { BadRequestException } from '@nestjs/common'
import { ReleaseWriteInput } from '@/releases/ports/release-write.repository'
export function enabledWriteValues(enabled: boolean) {
  return { is_enabled: enabled ? 1 : 0 }
}
export function releaseWriteValues(input: ReleaseWriteInput) {
  if (
    !Number.isSafeInteger(input.targetVersionCode) ||
    input.targetVersionCode < 0 ||
    input.targetVersionCode > 2147483647 ||
    !input.compatibleBaseVersionCodes.every(
      v => Number.isSafeInteger(v) && v >= 0 && v <= 2147483647
    )
  )
    throw new BadRequestException('Invalid version code')
  return {
    app_name: input.appName,
    release_id: input.releaseId,
    release_scope: input.releaseScope,
    policy_revision: 1,
    target_version_code: input.targetVersionCode,
    compatible_base_version_codes: JSON.stringify(
      input.compatibleBaseVersionCodes
    ),
    platforms: JSON.stringify(input.platforms),
    architectures: JSON.stringify(input.architectures),
    distribution_channel: input.distributionChannel,
    update_type: input.updateType,
    release_notes: input.releaseNotes,
    artifact_size_bytes: input.artifactSizeBytes,
    installer_source_url: input.installerSourceUrl,
    bundle_url: input.bundleUrl,
    ...enabledWriteValues(input.enabled),
    is_mandatory: input.mandatory ? 1 : 0,
    show_update_dialog: input.showUpdateDialog ? 1 : 0,
    created_at: input.createdAt,
    updated_at: input.createdAt,
    source_ip: input.sourceIp
  }
}
