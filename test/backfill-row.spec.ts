import { inspectBackfillRow } from '@/compat/legacy/persistence/backfill-row'
import { mapStoredReleaseRecord } from '@/releases/release-record.mapper'
import { mapFormalReleaseRecord } from '@/releases/formal-release.mapper'

const legacy = {
  id: 1088,
  name: 'app',
  ver: 110,
  base_versions: '1.0.0,105,100',
  platform: 'windows,linux',
  architecture: 'x64',
  enable: 0,
  mandatory: 0,
  show_dialog: 1,
  package_url: 'https://example.test/app.zip',
  update_type: 'hot',
  create_time: '2020-01-01 00:00:00',
  desc: 'old release',
  file_size: 1024
}

describe('historical field backfill', () => {
  it('preserves IDs, encoding and legacy base-version union semantics', () => {
    const result = inspectBackfillRow('version', legacy)
    expect(result.issues).toEqual([])
    expect(result.patch).toMatchObject({
      target_version_code: 110,
      compatible_base_version_codes: '[110,100,105]',
      platforms: '["windows","linux"]',
      is_enabled: 0,
      is_mandatory: 0,
      show_update_dialog: 1,
      bundle_url: legacy.package_url
    })
    expect(result.patch).not.toHaveProperty('id')
    expect(result.patch).not.toHaveProperty('ver')
    expect(result.patch).not.toHaveProperty('base_versions')
    expect(result.patch).not.toHaveProperty('updated_at')
    const migrated = { ...legacy, ...result.patch }
    expect(inspectBackfillRow('version', migrated)).toEqual({
      patch: {},
      issues: []
    })
    expect(mapFormalReleaseRecord(migrated).compatibleBaseVersionCodes).toEqual(
      [110, 100, 105]
    )
  })

  it('refuses to overwrite existing conflicting formal values', () => {
    const result = inspectBackfillRow('version', {
      ...legacy,
      is_enabled: 1,
      target_version_code: 999
    })
    expect(result.issues.map(issue => issue.field)).toEqual(
      expect.arrayContaining(['is_enabled', 'target_version_code'])
    )
    expect(result.patch).not.toHaveProperty('is_enabled')
    expect(result.patch).not.toHaveProperty('target_version_code')
  })

  it('preserves explicit v2 base-version sets that intentionally exclude target version', () => {
    const row = {
      ...legacy,
      base_versions: '100,105',
      compatible_base_version_codes: [100, 105]
    }
    const result = inspectBackfillRow('version', row)
    expect(result.issues).toEqual([])
    expect(result.patch).not.toHaveProperty('compatible_base_version_codes')
    expect(
      mapStoredReleaseRecord({ ...row, ...result.patch })
        .compatibleBaseVersionCodes
    ).toEqual([100, 105])
  })

  it('does not turn a private release public when repairing its revision', () => {
    const result = inspectBackfillRow('version', {
      ...legacy,
      release_scope: 'allowlist',
      policy_revision: 0,
      release_id: '10000000-0000-4000-8000-000000000000'
    })
    expect(result.issues).toEqual([])
    expect(result.patch.policy_revision).toBe(1)
    expect(result.patch).not.toHaveProperty('release_scope')
  })

  it.each([
    { base_versions: '*' },
    { enable: 'yes' },
    { ver: 'bad' },
    { release_id: 'old-unverified-identifier' },
    { release_scope: 'allowlist' },
    { create_time: 'not-a-date' }
  ])(
    'blocks ambiguous historical values without silently coercing them: %j',
    change => {
      expect(
        inspectBackfillRow('version', { ...legacy, ...change }).issues.length
      ).toBeGreaterThan(0)
    }
  )

  it('keeps telemetry record IDs, business extras and aggregated counts intact', () => {
    const source = {
      id: 17,
      name: 'app',
      ver_id: 1088,
      username: 'tester',
      create_time: '2020-01-01 00:00:00',
      extras: { opaque_key: true }
    }
    const report = inspectBackfillRow('success', source)
    expect(report.issues).toEqual([])
    expect(report.patch).toEqual({
      release_sequence: 1088,
      reported_username: 'tester',
      created_at: source.create_time
    })
    const error = inspectBackfillRow('errorLog', {
      ...source,
      report_count: 41,
      error_hash: 'existing'
    })
    expect(error.issues).toEqual([])
    expect(error.patch).not.toHaveProperty('report_count')
    expect(error.patch).not.toHaveProperty('error_hash')
    expect(error.patch).not.toHaveProperty('extras')
  })

  it('does not invent a replacement for a corrupt aggregate count', () => {
    expect(
      inspectBackfillRow('errorLog', { id: 1, report_count: -1 }).issues
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'report_count' })
      ])
    )
  })

  it('formal reading fails closed rather than falling back to an unmigrated flag', () => {
    const { patch } = inspectBackfillRow('version', legacy)
    expect(() =>
      mapFormalReleaseRecord({ ...legacy, ...patch, is_enabled: null })
    ).toThrow('is_enabled')
  })
})
