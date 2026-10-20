import { mapStoredReleaseRecord } from './release-record.mapper'

/** Selected only after an explicit, verified per-application cutover. */
export function mapFormalReleaseRecord(row: Record<string, unknown>) {
  for (const field of [
    'release_id',
    'release_scope',
    'policy_revision',
    'target_version_code',
    'compatible_base_version_codes',
    'platforms',
    'architectures',
    'is_enabled',
    'is_mandatory',
    'show_update_dialog',
    'update_type'
  ]) {
    if (row[field] == null)
      throw new Error(`Formal release field is missing: ${field}`)
  }
  for (const field of [
    'compatible_base_version_codes',
    'platforms',
    'architectures'
  ]) {
    const value: unknown =
      typeof row[field] === 'string' ? JSON.parse(row[field]) : row[field]
    if (
      !Array.isArray(value) ||
      !value.every(item =>
        field === 'compatible_base_version_codes'
          ? Number.isSafeInteger(item) && Number(item) >= 0
          : typeof item === 'string'
      )
    )
      throw new Error(`Invalid formal release list: ${field}`)
  }
  if (
    !['public', 'allowlist'].includes(String(row.release_scope)) ||
    !['full', 'hot'].includes(String(row.update_type))
  ) {
    throw new Error('Invalid formal release policy')
  }
  if (
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(
      String(row.release_id)
    ) ||
    !Number.isSafeInteger(Number(row.policy_revision)) ||
    Number(row.policy_revision) < 1 ||
    !Number.isSafeInteger(Number(row.id)) ||
    Number(row.id) < 1
  )
    throw new Error('Invalid formal release identity or revision')
  for (const field of ['is_enabled', 'is_mandatory', 'show_update_dialog']) {
    if (![0, 1, '0', '1', true, false].includes(row[field] as never))
      throw new Error(`Invalid formal flag: ${field}`)
  }
  const target = Number(row.target_version_code)
  if (!Number.isSafeInteger(target) || target < 0)
    throw new Error('Invalid formal target version')
  return mapStoredReleaseRecord({
    ...row,
    // Preserve legacy wire fields, but make their values agree with formal storage.
    enable: row.is_enabled,
    mandatory: row.is_mandatory,
    show_dialog: row.show_update_dialog,
    install_url: row.installer_source_url,
    package_url: row.bundle_url,
    desc: row.release_notes,
    file_size: row.artifact_size_bytes,
    channel: row.distribution_channel
  })
}
