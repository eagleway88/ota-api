import {
  releaseWriteValues,
  enabledWriteValues
} from '@/infrastructure/persistence/release-write.mapper'
import { SqlReleaseRepository } from '@/infrastructure/persistence/sql-release.repository'
import { releaseInput } from './fixtures/release'
import {
  mapStoredReleaseRecord,
  serializeRelease
} from '@/releases/release-record.mapper'
import { QueryRunner } from 'typeorm'
import { RegisteredApplication } from '@/applications/application-registry.service'
describe('canonical release storage', () => {
  it('round trips release fields and ignores injected storage identifiers', () => {
    const values = releaseWriteValues({
      ...releaseInput,
      release_sequence: 999
    } as typeof releaseInput)
    expect(values).not.toHaveProperty('release_sequence')
    const release = serializeRelease(
      mapStoredReleaseRecord({ release_sequence: 1, ...values })
    )
    expect(release).toMatchObject({
      appName: 'app',
      releaseSequence: 1,
      targetVersion: '1.3.10',
      enabled: true,
      releaseScope: 'public'
    })
    expect(release).not.toHaveProperty('scope')
  })
  it.each(['', '68', '1.03.10', '1.3.10-beta'])(
    'rejects invalid display version %s',
    targetVersion =>
      expect(() =>
        releaseWriteValues({ ...releaseInput, targetVersion })
      ).toThrow()
  )
  it('only updates canonical enabled state', () =>
    expect(enabledWriteValues(false)).toEqual({ is_enabled: 0 }))
  it('requires transaction ownership', async () => {
    const repository = new SqlReleaseRepository(),
      runner = { isTransactionActive: false } as QueryRunner
    await expect(
      repository.insert(runner, {} as RegisteredApplication, releaseInput)
    ).rejects.toThrow('transaction')
  })
})
