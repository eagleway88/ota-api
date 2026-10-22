import {
  legacyApplicationError,
  legacyFailureReport,
  legacySuccessReport,
  serializeLegacyReport
} from '@/compat/legacy/http/version/telemetry.mapper'
import {
  applicationErrorHash,
  applicationErrorIdentity,
  applicationErrorValues,
  sameStatusContent,
  statusReportValues,
  storedReport
} from '@/compat/legacy/persistence/telemetry-write.mapper'
import {
  ApplicationErrorInput,
  StatusReportInput
} from '@/telemetry/ports/telemetry-write.repository'

const at = new Date('2026-10-21T00:00:00Z')
const input: StatusReportInput = {
  appName: 'app',
  platform: 'windows',
  versionCode: 100,
  releaseSequence: 2000,
  reportedUsername: 'name',
  extras: { snake_key: { innerCamel: 1 } },
  sourceIp: 'localhost'
}

describe('telemetry compatibility mapping', () => {
  it('dual-writes only allowlisted fields without renaming arbitrary extras keys', () => {
    const values = statusReportValues(
      {
        ...input,
        id: 999,
        release_sequence: 999,
        report_count: 88
      } as StatusReportInput,
      { receivedAt: at }
    )
    expect(values).toEqual({
      name: 'app',
      platform: 'windows',
      ver: 100,
      ver_id: 2000,
      release_sequence: 2000,
      username: 'name',
      reported_username: 'name',
      ip: 'localhost',
      extras: '{"snake_key":{"innerCamel":1}}',
      create_time: at,
      created_at: at
    })
  })

  it('keeps legacy response keys and confines legacy extras key conversion to the wire boundary', () => {
    const report = storedReport({
      id: 7,
      ...statusReportValues(input, { receivedAt: at }),
      extras_json: '{"snake_key":{"innerCamel":1}}'
    })
    expect(report.extras).toEqual({ snake_key: { innerCamel: 1 } })
    expect(serializeLegacyReport(report)).toEqual({
      id: 7,
      name: 'app',
      platform: 'windows',
      ver: 100,
      verId: 2000,
      username: 'name',
      ip: 'localhost',
      extras: { snakeKey: { innerCamel: 1 } },
      createTime: at
    })
  })

  it.each(['"123"', '"null"', '"true"', '"{\\"key\\":1}"'])(
    'decodes stored JSON text exactly once: %s',
    raw => {
      expect(storedReport({ extras_json: raw }).extras).toEqual(JSON.parse(raw))
    }
  )

  it('compares retry content by value, ignoring JSON key order, receipt time and IP', () => {
    const row = {
      id: 1,
      ...statusReportValues(input, { receivedAt: at }),
      extras_json: '{"snake_key":{"innerCamel":1}}'
    }
    const report = storedReport(row)
    expect(sameStatusContent(report, { ...input, sourceIp: 'another' })).toBe(
      true
    )
    expect(sameStatusContent(report, { ...input, releaseSequence: 2001 })).toBe(
      false
    )
    expect(
      sameStatusContent(report, {
        ...input,
        extras: { snake_key: { innerCamel: 2 } }
      })
    ).toBe(false)
  })

  it('normalizes legacy JSON strings but never forwards supplied database identifiers', () => {
    const body = {
      name: 'app',
      platform: 'windows',
      ver: 100,
      verId: 2000,
      extras: '{"device_id":"a"}',
      id: 99,
      releaseSequence: 999
    }
    const report = legacySuccessReport(body as never, 'localhost')
    expect(report).toMatchObject({
      releaseSequence: 2000,
      extras: { device_id: 'a' }
    })
    expect(report).not.toHaveProperty('id')
    expect(
      legacyFailureReport({ ...body, message: 'failed' } as never, 'localhost')
        .recordId
    ).toBe(99)
    expect(
      legacyApplicationError(
        { ...body, kind: 'crash', message: 'crash' } as never,
        'localhost'
      )
    ).not.toHaveProperty('releaseSequence')
    expect(
      legacySuccessReport({ ...body, extras: 'not JSON' } as never, 'localhost')
        .extras
    ).toBe('not JSON')
    expect(
      legacyFailureReport(
        { ...body, id: 0, reportId: null, message: 'new' } as never,
        'localhost'
      )
    ).toMatchObject({ recordId: undefined, reportId: undefined })
  })

  it('keeps historical normalized MD5 grouping and detects ambiguous delimiter tuples', () => {
    const original: ApplicationErrorInput = {
      ...input,
      kind: 'crash',
      message: ' problem\r\nline ',
      stack: ' stack '
    }
    const normalized = { ...original, message: 'problem\nline', stack: 'stack' }
    expect(applicationErrorHash(original)).toBe(
      applicationErrorHash(normalized)
    )
    expect(applicationErrorValues(original, { receivedAt: at })).toMatchObject({
      report_count: 1,
      error_hash: applicationErrorHash(original),
      updated_at: at,
      update_time: at
    })
    const a = { ...original, message: 'a|b', stack: 'c' }
    const b = { ...original, message: 'a', stack: 'b|c' }
    expect(applicationErrorHash(a)).toBe(applicationErrorHash(b))
    expect(applicationErrorIdentity(a)).not.toEqual(applicationErrorIdentity(b))
  })
})
