import { Release } from '@/contracts/releases'
function list(row: Record<string, unknown>, key: string): unknown[] {
  const value: unknown =
    typeof row[key] === 'string' ? JSON.parse(row[key]) : row[key]
  if (!Array.isArray(value)) throw new Error('Invalid release list: ' + key)
  return value
}
export function mapStoredReleaseRecord(row: Record<string, unknown>): Release {
  const sequence = Number(row.release_sequence),
    revision = Number(row.policy_revision),
    target = Number(row.target_version_code)
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !Number.isSafeInteger(target) ||
    target < 0 ||
    typeof row.app_name !== 'string' ||
    typeof row.release_id !== 'string'
  )
    throw new Error('Invalid release identity or version')
  if (
    !['public', 'allowlist'].includes(String(row.release_scope)) ||
    !['full', 'hot'].includes(String(row.update_type))
  )
    throw new Error('Invalid release policy')
  const bases = list(row, 'base_version_codes'),
    platforms = list(row, 'platforms'),
    architectures = list(row, 'architectures')
  if (
    !bases.every(v => Number.isSafeInteger(v) && Number(v) >= 0) ||
    !platforms.length ||
    !platforms.every(v => typeof v === 'string') ||
    !architectures.every(v => typeof v === 'string')
  )
    throw new Error('Invalid release context')
  const flag = (key: string) => {
    const value = row[key]
    if (
      value !== 0 &&
      value !== 1 &&
      value !== '0' &&
      value !== '1' &&
      value !== true &&
      value !== false
    )
      throw new Error('Invalid release flag: ' + key)
    return value === 1 || value === '1' || value === true
  }
  return {
    releaseId: row.release_id,
    releaseSequence: sequence,
    appName: row.app_name,
    targetVersionCode: target,
    baseVersionCodes: bases as number[],
    platforms: platforms,
    architectures: architectures,
    distributionChannel:
      row.distribution_channel == null
        ? undefined
        : (row.distribution_channel as string),
    updateType: row.update_type as Release['updateType'],
    scope: row.release_scope as Release['scope'],
    enabled: flag('is_enabled'),
    mandatory: flag('is_mandatory'),
    showUpdateDialog: flag('show_update_dialog'),
    policyRevision: revision,
    releaseNotes: row.release_notes as string | null,
    artifactSizeBytes:
      row.artifact_size_bytes == null ? null : Number(row.artifact_size_bytes),
    installerSourceUrl: row.installer_source_url as string | null,
    bundleUrl: row.bundle_url as string | null,
    createdAt: row.created_at as Date | string,
    updatedAt: row.updated_at as Date | string
  }
}
export function serializeRelease(
  release: Release,
  mandatory = release.mandatory,
  showUpdateDialog = release.showUpdateDialog
) {
  const { scope, ...fields } = release
  return { ...fields, releaseScope: scope, mandatory, showUpdateDialog }
}
