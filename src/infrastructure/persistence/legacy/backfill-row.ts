import { createHash, randomUUID } from 'crypto'
import { normalizeVersionValue } from '@/utils/version'
import { mapStoredReleaseRecord } from '@/releases/release-record.mapper'

export type MigratedTableKind = 'version' | 'success' | 'error' | 'errorLog'
export type StoredRow = Record<string, unknown>
export type RowIssue = { id: number; field: string; reason: string }
export const migratedTableKinds: MigratedTableKind[] = [
  'version',
  'success',
  'error',
  'errorLog'
]

function list(value: unknown): string[] {
  if (value == null || value === '') return []
  if (typeof value !== 'string') throw new Error('Expected legacy CSV text')
  return [
    ...new Set(
      value
        .split(',')
        .map(part => part.trim())
        .filter(Boolean)
    )
  ]
}

function integer(value: unknown, minimum = 0) {
  const number = Number(value)
  if (
    value == null ||
    value === '' ||
    !Number.isSafeInteger(number) ||
    number < minimum ||
    number > 2147483647
  ) {
    throw new Error('Invalid legacy integer; manual review required')
  }
  return number
}

function version(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string')
    throw new Error('Missing legacy version')
  return integer(normalizeVersionValue(value))
}

function flag(value: unknown) {
  if (value == null) return 1
  if ([0, 1, '0', '1', false, true].includes(value as never))
    return Number(value)
  throw new Error('Invalid legacy boolean; manual review required')
}

function timestamp(value: unknown) {
  if (value == null) return null
  if (value instanceof Date && Number.isFinite(value.getTime())) return value
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value)))
    return value
  throw new Error('Invalid historical timestamp')
}

function comparable(value: unknown, json = false): string {
  if (value == null) return 'null'
  if (json) {
    const parsed: unknown =
      typeof value === 'string' ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) throw new Error('Expected JSON array')
    return JSON.stringify([...(parsed as unknown[])].sort())
  }
  if (value instanceof Date) return value.toISOString()
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  )
    return String(value)
  throw new Error('Expected a scalar historical field')
}

export function inspectBackfillRow(kind: MigratedTableKind, row: StoredRow) {
  const patch: StoredRow = {}
  const issues: RowIssue[] = []
  const id = Number(row.id)
  const issue = (field: string, reason: string) =>
    issues.push({ id, field, reason })
  const field = (
    name: string,
    derive: () => unknown,
    json = false,
    allowed?: unknown
  ) => {
    try {
      const expected = derive()
      const current = row[name]
      if (current == null) {
        if (expected != null)
          patch[name] = json ? JSON.stringify(expected) : expected
      } else if (
        comparable(current, json) !== comparable(expected, json) &&
        (allowed === undefined ||
          comparable(current, json) !== comparable(allowed, json))
      ) {
        issue(
          name,
          'Existing formal value conflicts with legacy data; not overwritten'
        )
      }
    } catch (error) {
      issue(
        name,
        error instanceof Error ? error.message : 'Invalid historical value'
      )
    }
  }

  try {
    integer(row.id, 1)
  } catch {
    issue('id', 'Invalid primary key')
  }
  if (kind === 'version') {
    if (row.release_scope === 'allowlist' && !row.release_id) {
      issue(
        'release_id',
        'Private release has no stable audience identity; manual reconciliation required'
      )
    }
    if (row.release_id == null || row.release_id === '')
      patch.release_id = randomUUID()
    else if (
      typeof row.release_id !== 'string' ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(row.release_id)
    ) {
      issue('release_id', 'Existing release ID is not a UUID')
    }
    if (row.release_scope == null || row.release_scope === '')
      patch.release_scope = 'public'
    else if (
      row.release_scope !== 'public' &&
      row.release_scope !== 'allowlist'
    )
      issue('release_scope', 'Unknown release scope')
    if (row.policy_revision == null || Number(row.policy_revision) < 1)
      patch.policy_revision = 1
    else if (!Number.isSafeInteger(Number(row.policy_revision)))
      issue('policy_revision', 'Invalid policy revision')
    field('target_version_code', () => version(row.ver))
    let bases: number[] | undefined
    try {
      bases = list(row.base_versions).map(version)
    } catch {
      issue('base_versions', 'Invalid legacy base version list')
    }
    if (bases)
      field(
        'compatible_base_version_codes',
        () => [...new Set([version(row.ver), ...bases])],
        true,
        bases
      )
    field('platforms', () => list(row.platform), true)
    field('architectures', () => list(row.architecture), true)
    field('is_enabled', () => flag(row.enable))
    field('is_mandatory', () => flag(row.mandatory))
    field('show_update_dialog', () => flag(row.show_dialog))
    field('release_notes', () => row.desc ?? null)
    field('artifact_size_bytes', () =>
      row.file_size == null ? null : integer(row.file_size)
    )
    field('installer_source_url', () => row.install_url ?? null)
    field('bundle_url', () => row.package_url ?? null)
    field('distribution_channel', () => row.channel ?? null)
    field('created_at', () => timestamp(row.create_time))
    if (row.update_type == null || row.update_type === '') {
      patch.update_type = row.install_url ? 'full' : 'hot'
    } else if (row.update_type !== 'full' && row.update_type !== 'hot')
      issue('update_type', 'Unknown update type')
    // Do not invent historical updated_at timestamps or audit/task events.
  } else {
    field('reported_username', () => row.username ?? null)
    field('created_at', () => timestamp(row.create_time))
    if (kind !== 'success')
      field('updated_at', () => timestamp(row.update_time ?? row.create_time))
    if (kind !== 'errorLog')
      field('release_sequence', () => integer(row.ver_id, 1))
    else {
      if (row.report_count == null) patch.report_count = 1
      else if (
        !Number.isSafeInteger(Number(row.report_count)) ||
        Number(row.report_count) < 1
      ) {
        issue(
          'report_count',
          'Invalid aggregate count; cannot infer lost historical events'
        )
      }
      if (row.error_hash == null || row.error_hash === '') {
        try {
          patch.error_hash = createHash('md5')
            .update(
              ['name', 'platform', 'ver', 'kind', 'message', 'stack']
                .map(key => comparable(row[key] ?? ''))
                .join('|')
            )
            .digest('hex')
        } catch {
          issue('error_hash', 'Invalid historical error fingerprint source')
        }
      }
    }
  }

  if (kind === 'version' && !issues.length) {
    const decisionFields = (record: StoredRow) =>
      Object.fromEntries(
        Object.entries(mapStoredReleaseRecord(record)).filter(
          ([key]) => key !== 'releaseId' && key !== 'legacyPayload'
        )
      )
    if (
      JSON.stringify(decisionFields(row)) !==
      JSON.stringify(decisionFields({ ...row, ...patch }))
    ) {
      issue('decision', 'Backfill would change effective update eligibility')
    }
  }
  return { patch, issues }
}

/** Columns that migration must never rewrite, used in before/after fingerprints. */
export const legacyFingerprintFields: Record<
  MigratedTableKind,
  readonly string[]
> = {
  version: [
    'id',
    'name',
    'ver',
    'base_versions',
    'desc',
    'file_size',
    'enable',
    'mandatory',
    'show_dialog',
    'install_url',
    'package_url',
    'channel',
    'platform',
    'architecture',
    'ip',
    'create_time'
  ],
  success: [
    'id',
    'name',
    'platform',
    'ver',
    'ver_id',
    'ip',
    'extras',
    'username',
    'create_time',
    'report_id'
  ],
  error: [
    'id',
    'name',
    'platform',
    'ver',
    'ver_id',
    'ip',
    'extras',
    'username',
    'message',
    'create_time',
    'update_time',
    'report_id'
  ],
  errorLog: [
    'id',
    'name',
    'platform',
    'ver',
    'ip',
    'extras',
    'kind',
    'message',
    'stack',
    'username',
    'create_time',
    'update_time'
  ]
}
