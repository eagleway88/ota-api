import { DispatchProgress } from '@/realtime/dispatch/dispatch-progress'

export function dispatchProgressValues(progress: DispatchProgress, at: Date) {
  return {
    scanned_count: progress.scanned,
    eligible_count: progress.eligible,
    update_emit_count: progress.updated,
    revoke_emit_count: progress.revoked,
    emit_error_count: progress.emitErrors,
    skip_summary: JSON.stringify(progress.skipSummary),
    release_summary: JSON.stringify(progress.releaseSummary),
    last_checkpoint_at: at
  }
}
