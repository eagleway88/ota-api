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
  it('round trips modern fields without old aliases or injected identifiers', () => {
    const values = releaseWriteValues({
      ...releaseInput,
      id: 1
    } as typeof releaseInput)
    expect(values).not.toHaveProperty('id')
    expect(values).not.toHaveProperty('ver')
    expect(values).not.toHaveProperty('name')
    const release = serializeRelease(
      mapStoredReleaseRecord({ id: 2000, ...values })
    )
    expect(release).toMatchObject({
      appName: 'app',
      releaseSequence: 2000,
      targetVersionCode: 110,
      enabled: true,
      releaseScope: 'public'
    })
    for (const key of [
      'scope',
      'id',
      'name',
      'ver',
      'enable',
      'downloadUrl',
      'type'
    ])
      expect(release).not.toHaveProperty(key)
  })
  it.each([-1, 1.5, 2147483648, NaN])(
    'rejects invalid native version %s',
    targetVersionCode =>
      expect(() =>
        releaseWriteValues({ ...releaseInput, targetVersionCode })
      ).toThrow()
  )
  it('rejects old-only stored records', () =>
    expect(() =>
      mapStoredReleaseRecord({
        id: 2000,
        name: 'app',
        ver: 110,
        platform: 'windows'
      })
    ).toThrow())
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
