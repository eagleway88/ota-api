import { QueryRunner } from 'typeorm'
import type { RegisteredApplication } from '@/applications/application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'
import { normalizeReleaseAudience } from '@/releases/release-audience'
import {
  AUDIENCE_AUDIT_PART_SIZE,
  planAudienceChange
} from '@/audit/audience-change'
import { insertReleaseSuccessAudit } from '@/audit/release-success-audit'

const users = (prefix: string, count: number) =>
  Array.from(
    { length: count },
    (_, i) => `app:windows:${prefix}-${i.toString().padStart(5, '0')}`
  )

describe('bounded complete audience audit', () => {
  it('records deterministic exact set differences without mutating either snapshot', () => {
    const before = {
      scope: 'allowlist' as const,
      userIds: ['app:windows:2', 'app:windows:1', 'app:windows:2']
    }
    const after = {
      scope: 'allowlist' as const,
      userIds: ['app:windows:3', 'app:windows:2', 'app:windows:3']
    }
    expect(planAudienceChange(before, after)).toEqual({
      summary: {
        scopeBefore: 'allowlist',
        scopeAfter: 'allowlist',
        userCountBefore: 2,
        userCountAfter: 2,
        addedCount: 1,
        removedCount: 1,
        partCount: 1
      },
      parts: [
        { addedUserIds: ['app:windows:3'], removedUserIds: ['app:windows:1'] }
      ]
    })
    expect(before.userIds).toEqual([
      'app:windows:2',
      'app:windows:1',
      'app:windows:2'
    ])
    expect(after.userIds).toEqual([
      'app:windows:3',
      'app:windows:2',
      'app:windows:3'
    ])
  })

  it('splits additions and removals using a shared per-part limit', () => {
    const before = users('old', 150)
    const after = users('new', 151)
    const change = planAudienceChange(
      { scope: 'allowlist', userIds: before },
      { scope: 'allowlist', userIds: after }
    )
    expect(change.summary.partCount).toBe(2)
    expect(change.parts[0].addedUserIds).toHaveLength(151)
    expect(change.parts[0].removedUserIds).toHaveLength(49)
    expect(change.parts.flatMap(part => part.addedUserIds)).toEqual(after)
    expect(change.parts.flatMap(part => part.removedUserIds)).toEqual(before)
  })

  it('retains every identifier for the maximum 5000-to-5000 replacement', () => {
    const before = users('old', MAX_RELEASE_USERS)
    const after = users('new', MAX_RELEASE_USERS)
    const change = planAudienceChange(
      { scope: 'allowlist', userIds: before },
      { scope: 'allowlist', userIds: after }
    )
    expect(change.parts).toHaveLength(50)
    expect(
      change.parts.every(
        part =>
          part.addedUserIds.length + part.removedUserIds.length <=
          AUDIENCE_AUDIT_PART_SIZE
      )
    ).toBe(true)
    expect(change.parts.flatMap(part => part.addedUserIds)).toEqual(after)
    expect(change.parts.flatMap(part => part.removedUserIds)).toEqual(before)
  })

  it('represents empty/no-op and scope-only changes with one complete part', () => {
    for (const before of ['public', 'allowlist'] as const) {
      const change = planAudienceChange(
        { scope: before, userIds: [] },
        { scope: 'allowlist', userIds: [] }
      )
      expect(change.summary).toMatchObject({
        scopeBefore: before,
        scopeAfter: 'allowlist',
        partCount: 1,
        addedCount: 0,
        removedCount: 0
      })
      expect(change.parts).toEqual([{ addedUserIds: [], removedUserIds: [] }])
    }
  })

  it('records initial publication and public-scope clearing without truncation', () => {
    const list = users('initial', 201)
    const published = planAudienceChange(
      { scope: null, userIds: [] },
      { scope: 'allowlist', userIds: list }
    )
    expect(published.summary).toMatchObject({
      scopeBefore: null,
      addedCount: 201,
      removedCount: 0,
      partCount: 2
    })
    const cleared = planAudienceChange(
      { scope: 'allowlist', userIds: list },
      { scope: 'public', userIds: [] }
    )
    expect(cleared.summary).toMatchObject({
      scopeAfter: 'public',
      addedCount: 0,
      removedCount: 201,
      partCount: 2
    })
    expect(cleared.parts.flatMap(part => part.removedUserIds)).toEqual(list)
  })

  it.each(['before', 'after'] as const)(
    'rejects over-limit %s state instead of silently cutting the audit',
    side => {
      const valid = { scope: 'allowlist' as const, userIds: [] }
      const oversized = { ...valid, userIds: users('oversized', 5001) }
      expect(() =>
        planAudienceChange(
          side === 'before' ? oversized : valid,
          side === 'after' ? oversized : valid
        )
      ).toThrow('audit limit')
    }
  )

  it('rejects malformed stored identifiers and preserves allowed identifier text exactly', () => {
    expect(() =>
      planAudienceChange(
        { scope: 'allowlist', userIds: [''] },
        { scope: 'public', userIds: [] }
      )
    ).toThrow('invalid')
    const id = `app:windows:${'中'.repeat(179)}`
    expect(
      planAudienceChange(
        { scope: 'allowlist', userIds: [id] },
        { scope: 'public', userIds: [] }
      ).parts[0].removedUserIds
    ).toEqual([id])
  })

  it.each(['array'] as const)(
    'applies the request cap before deduplication to %s inputs',
    () => {
      const list = Array<string>(5001).fill('app:windows:1')
      expect(() =>
        normalizeReleaseAudience({
          appName: 'app',
          platforms: ['windows'],
          releaseScope: 'allowlist',
          userIds: list
        })
      ).toThrow('5000')
    }
  )

  it('requires a caller-owned transaction for successful audit writes', async () => {
    await expect(
      insertReleaseSuccessAudit(
        { isTransactionActive: false } as QueryRunner,
        {} as RegisteredApplication,
        {} as never
      )
    ).rejects.toThrow('requires a transaction')
  })

  it('assigns contiguous part numbers with identical correlation metadata and propagates any insert failure', async () => {
    const rows: Record<string, unknown>[] = []
    const error = new Error('second part rejected')
    const builder = {
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: (row: Record<string, unknown>) => {
        rows.push(row)
        return builder
      },
      execute: jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(error)
    }
    const runner = {
      isTransactionActive: true,
      manager: { createQueryBuilder: () => builder }
    } as unknown as QueryRunner
    const application = {
      tables: new ApplicationTableResolver().resolve('app', 'app')
    } as RegisteredApplication
    await expect(
      insertReleaseSuccessAudit(runner, application, {
        context: {
          requestId: 'request',
          actorKeyId: '10000000-0000-4000-8000-000000000001'
        },
        operationId: 'operation',
        releaseId: 'release',
        taskId: 'task',
        action: 'audience_changed',
        revisionBefore: 1,
        revisionAfter: 2,
        changeSummary: {},
        audience: planAudienceChange(
          { scope: 'allowlist', userIds: [] },
          { scope: 'allowlist', userIds: users('new', 401) }
        )
      })
    ).rejects.toBe(error)
    expect(rows.map(row => row.part_no)).toEqual([1, 2])
    for (const row of rows)
      expect(row).toMatchObject({
        operation_id: 'operation',
        request_id: 'request',
        task_id: 'task',
        revision_before: 1,
        revision_after: 2
      })
  })
})
