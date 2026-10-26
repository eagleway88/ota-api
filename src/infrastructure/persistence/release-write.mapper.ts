import { isAppVersion } from '@/contracts/version'
import { BadRequestException } from '@nestjs/common'
import { ReleaseWriteInput } from '@/releases/ports/release-write.repository'
export function enabledWriteValues(enabled: boolean) {
  return { is_enabled: enabled ? 1 : 0 }
}
export function releaseWriteValues(input: ReleaseWriteInput) {
  if (!isAppVersion(input.targetVersion))
    throw new BadRequestException('Invalid display version')
  return {
    app_name: input.appName,
    release_id: input.releaseId,
    release_scope: input.releaseScope,
    policy_revision: 1,
    target_version: input.targetVersion,
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
