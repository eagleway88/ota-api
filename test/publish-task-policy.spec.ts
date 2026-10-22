import {
  canClaimPublishTask,
  publishTaskFailureTransition
} from '@/jobs/publish/publish-task-policy'

describe('publish task policy', () => {
  const now = new Date('2026-10-20T00:00:00.000Z')

  it('only reclaims running tasks after the lease expires', () => {
    expect(
      canClaimPublishTask('running', null, new Date(now.getTime() + 1), now)
    ).toBe(false)
    expect(
      canClaimPublishTask('running', null, new Date(now.getTime() - 1), now)
    ).toBe(true)
  })

  it('backs off retries and enters a terminal state at the limit', () => {
    expect(publishTaskFailureTransition(2, 5, now)).toEqual({
      status: 'retry_wait',
      nextRunAt: new Date(now.getTime() + 10_000),
      finishedAt: null
    })
    expect(publishTaskFailureTransition(5, 5, now)).toEqual({
      status: 'failed',
      nextRunAt: new Date(now.getTime() + 80_000),
      finishedAt: now
    })
  })
})
