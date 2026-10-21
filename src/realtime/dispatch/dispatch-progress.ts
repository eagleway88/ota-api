import { UpdateSkipReason } from '@/contracts/releases'

export type DispatchSkipReason =
  | UpdateSkipReason
  | 'subscription_changed'
  | 'disconnected'
  | 'unchanged'
  | 'revoke_emit_failed'
export type DispatchRelease = { releaseId: string; releaseSequence: number }
type ReleaseCounts = DispatchRelease & {
  eligible: number
  updated: number
  revoked: number
  emitErrors: number
}
export type DispatchProgress = {
  scanned: number
  eligible: number
  updated: number
  revoked: number
  emitErrors: number
  skipSummary: Partial<Record<DispatchSkipReason, number>>
  releaseSummary: {
    limit: number
    complete: boolean
    omittedCounts: {
      eligible: number
      updated: number
      revoked: number
      emitErrors: number
    }
    entries: ReleaseCounts[]
  }
}

/** Bounded aggregate only: never retain socket IDs, user IDs or payloads. */
export class DispatchMetrics {
  private readonly counts: DispatchProgress = {
    scanned: 0,
    eligible: 0,
    updated: 0,
    revoked: 0,
    emitErrors: 0,
    skipSummary: {},
    releaseSummary: {
      limit: 100,
      complete: true,
      omittedCounts: { eligible: 0, updated: 0, revoked: 0, emitErrors: 0 },
      entries: []
    }
  }
  private readonly releases = new Map<number, ReleaseCounts>()

  scan() {
    this.counts.scanned += 1
  }

  skip(reason: DispatchSkipReason) {
    this.counts.skipSummary[reason] = (this.counts.skipSummary[reason] ?? 0) + 1
  }

  count(
    kind: 'eligible' | 'updated' | 'revoked' | 'emitErrors',
    release: DispatchRelease
  ) {
    this.counts[kind] += 1
    let entry = this.releases.get(release.releaseSequence)
    if (!entry && this.releases.size < this.counts.releaseSummary.limit) {
      entry = {
        releaseId: release.releaseId,
        releaseSequence: release.releaseSequence,
        eligible: 0,
        updated: 0,
        revoked: 0,
        emitErrors: 0
      }
      this.releases.set(release.releaseSequence, entry)
    }
    if (entry) entry[kind] += 1
    else {
      this.counts.releaseSummary.complete = false
      this.counts.releaseSummary.omittedCounts[kind] += 1
    }
  }

  snapshot(): DispatchProgress {
    return {
      ...this.counts,
      skipSummary: { ...this.counts.skipSummary },
      releaseSummary: {
        ...this.counts.releaseSummary,
        omittedCounts: { ...this.counts.releaseSummary.omittedCounts },
        entries: Array.from(this.releases.values(), entry => ({ ...entry }))
      }
    }
  }
}
