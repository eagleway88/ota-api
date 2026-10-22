export type PublishTaskStatus =
  'pending' | 'running' | 'retry_wait' | 'succeeded' | 'failed'

export function canClaimPublishTask(
  status: PublishTaskStatus,
  nextRunAt: Date | null,
  leaseUntil: Date | null,
  now: Date
) {
  if (status === 'pending' || status === 'retry_wait') {
    return Boolean(nextRunAt && nextRunAt.getTime() <= now.getTime())
  }
  return Boolean(
    status === 'running' && leaseUntil && leaseUntil.getTime() <= now.getTime()
  )
}

export function publishTaskFailureTransition(
  attemptNo: number,
  maximumAttempts: number,
  now: Date
) {
  const exhausted = attemptNo >= maximumAttempts
  const delayMs = Math.min(5_000 * 2 ** Math.max(attemptNo - 1, 0), 300_000)
  return {
    status: exhausted ? ('failed' as const) : ('retry_wait' as const),
    nextRunAt: new Date(now.getTime() + delayMs),
    finishedAt: exhausted ? now : null
  }
}
