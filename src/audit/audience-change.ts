import { ConflictException } from '@nestjs/common'
import type { ReleaseScope } from '@/contracts/releases'
import { MAX_RELEASE_USERS } from '@/contracts/release-limits'

export const AUDIENCE_AUDIT_PART_SIZE = 200

export type AudienceSnapshot = {
  scope: ReleaseScope | null
  userIds: readonly string[]
}

function members(snapshot: AudienceSnapshot) {
  if (
    ![null, 'public', 'allowlist'].includes(snapshot.scope) ||
    !Array.isArray(snapshot.userIds) ||
    snapshot.userIds.length > MAX_RELEASE_USERS ||
    snapshot.userIds.some(
      id => typeof id !== 'string' || !id || id.length > 191
    ) ||
    (snapshot.scope === null && snapshot.userIds.length > 0)
  ) {
    throw new ConflictException(
      'Stored audience is invalid or exceeds the audit limit'
    )
  }
  // Audit exact persisted identifiers, not another normalized copy of them.
  return new Set<string>(snapshot.userIds)
}

/** Stable, complete set differences. No truncation and no raw request metadata. */
export function planAudienceChange(
  before: AudienceSnapshot,
  after: AudienceSnapshot
) {
  const previous = members(before)
  const next = members(after)
  const added = [...next].filter(id => !previous.has(id)).sort()
  const removed = [...previous].filter(id => !next.has(id)).sort()
  const changes = [
    ...added.map(userId => ({ userId, added: true })),
    ...removed.map(userId => ({ userId, added: false }))
  ]
  const parts: Array<{ addedUserIds: string[]; removedUserIds: string[] }> = []
  for (
    let offset = 0;
    offset < changes.length;
    offset += AUDIENCE_AUDIT_PART_SIZE
  ) {
    const chunk = changes.slice(offset, offset + AUDIENCE_AUDIT_PART_SIZE)
    parts.push({
      addedUserIds: chunk.filter(item => item.added).map(item => item.userId),
      removedUserIds: chunk.filter(item => !item.added).map(item => item.userId)
    })
  }
  if (!parts.length) parts.push({ addedUserIds: [], removedUserIds: [] })
  return {
    summary: {
      scopeBefore: before.scope,
      scopeAfter: after.scope,
      userCountBefore: previous.size,
      userCountAfter: next.size,
      addedCount: added.length,
      removedCount: removed.length,
      partCount: parts.length
    },
    parts
  }
}

export type AudienceChange = ReturnType<typeof planAudienceChange>
