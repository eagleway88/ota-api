import type { CreateReleaseDraftDto } from './release-draft.dto'

const fields = [
  'targetVersionCode',
  'compatibleBaseVersionCodes',
  'platforms',
  'architectures',
  'distributionChannel',
  'updateType',
  'releaseScope',
  'userIds',
  'releaseNotes',
  'artifactId',
  'installerSourceUrl',
  'bundleUrl',
  'artifactSizeBytes',
  'enabled',
  'mandatory',
  'showUpdateDialog'
] as const satisfies readonly (keyof CreateReleaseDraftDto)[]

// MySQL JSON storage can reorder object keys. Preserve array order and scalar types.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => canonical(item))
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map(key => [key, canonical(record[key])])
    )
  }
  return value
}

export function sameDraftContent(before: unknown, after: unknown) {
  return JSON.stringify(canonical(before)) === JSON.stringify(canonical(after))
}

/** Audit field names only: URL credentials, free text and unknown DTO keys stay out. */
export function draftChangedFields(
  before: Partial<CreateReleaseDraftDto>,
  after: CreateReleaseDraftDto
) {
  return fields.filter(field => !sameDraftContent(before[field], after[field]))
}
