import { DispatchMetrics } from '@/realtime/dispatch/dispatch-progress'

describe('DispatchMetrics', () => {
  it('bounds per-release summaries and accounts for omitted counts without retaining payloads', () => {
    const metrics = new DispatchMetrics()
    for (let index = 0; index < 102; index++) {
      const release = {
        releaseId: `release-${index}`,
        releaseSequence: 2000 + index,
        legacyPayload: { secret: 'private' }
      }
      metrics.scan()
      metrics.count('eligible', release)
      metrics.count('updated', release)
    }
    const result = metrics.snapshot()
    expect(result.scanned).toBe(102)
    expect(result.releaseSummary.entries).toHaveLength(100)
    expect(result.releaseSummary).toMatchObject({
      complete: false,
      omittedCounts: { eligible: 2, updated: 2, revoked: 0, emitErrors: 0 }
    })
    expect(result.releaseSummary.entries[0]).toEqual({
      releaseId: 'release-0',
      releaseSequence: 2000,
      eligible: 1,
      updated: 1,
      revoked: 0,
      emitErrors: 0
    })
    expect(JSON.stringify(result)).not.toContain('private')
  })

  it('returns detached snapshots for asynchronous persistence', () => {
    const metrics = new DispatchMetrics()
    const release = { releaseId: 'release', releaseSequence: 2000 }
    metrics.count('updated', release)
    metrics.skip('disconnected')
    const snapshot = metrics.snapshot()
    metrics.count('updated', release)
    metrics.skip('disconnected')
    expect(snapshot.updated).toBe(1)
    expect(snapshot.releaseSummary.entries[0].updated).toBe(1)
    expect(snapshot.skipSummary.disconnected).toBe(1)
  })
})
