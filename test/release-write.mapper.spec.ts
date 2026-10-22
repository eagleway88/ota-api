import { ReleaseWriteInput } from '@/releases/ports/release-write.repository'
import { inspectBackfillRow } from '@/compat/legacy/persistence/backfill-row'
import {
  dualWriteReleaseValues,
  enabledWriteValues,
  legacyReleaseWriteValues
} from '@/compat/legacy/persistence/release-write.mapper'
import { DualWriteReleaseRepository } from '@/compat/legacy/persistence/dual-write-release.repository'
import { QueryRunner } from 'typeorm'
import { RegisteredApplication } from '@/applications/application-registry.service'

const input: ReleaseWriteInput = {
  appName: 'app',
  releaseId: '10000000-0000-4000-8000-000000000000',
  targetVersionCode: 110,
  compatibleBaseVersionCodes: [100, 105],
  platforms: ['windows', 'linux'],
  architectures: ['x64'],
  distributionChannel: 'stable',
  updateType: 'hot',
  releaseScope: 'public',
  releaseNotes: 'notes',
  artifactSizeBytes: 4096,
  installerSourceUrl: 'https://example.test/app.exe',
  bundleUrl: 'https://example.test/app.zip',
  enabled: false,
  mandatory: false,
  showUpdateDialog: true,
  createdAt: new Date('2026-10-21T00:00:00Z'),
  sourceIp: '127.0.0.1'
}
const legacy = {
  name: input.appName,
  releaseId: input.releaseId,
  ver: '1.1.0',
  baseVersions: '1.0.0,105,100',
  platform: 'windows, linux,windows',
  architecture: 'x64',
  releaseScope: 'public',
  updateType: 'hot',
  createTime: input.createdAt,
  enable: '0',
  mandatory: 0,
  showDialog: 1,
  packageUrl: input.bundleUrl,
  desc: input.releaseNotes,
  fileSize: input.artifactSizeBytes
}

describe('central publication dual-write mapping', () => {
  it('writes every paired field from one formal input and preserves the explicit v2 base set', () => {
    const values = dualWriteReleaseValues(input)
    expect(values).toMatchObject({
      ver: 110,
      target_version_code: 110,
      base_versions: '100,105',
      compatible_base_version_codes: '[100,105]',
      platforms: '["windows","linux"]',
      platform: 'windows,linux',
      architectures: '["x64"]',
      architecture: 'x64',
      release_notes: 'notes',
      desc: 'notes',
      artifact_size_bytes: 4096,
      file_size: 4096,
      installer_source_url: input.installerSourceUrl,
      install_url: input.installerSourceUrl,
      bundle_url: input.bundleUrl,
      package_url: input.bundleUrl,
      distribution_channel: 'stable',
      channel: 'stable',
      is_enabled: 0,
      enable: 0,
      is_mandatory: 0,
      mandatory: 0,
      show_update_dialog: 1,
      show_dialog: 1,
      created_at: input.createdAt,
      create_time: input.createdAt
    })
    expect(inspectBackfillRow('version', { id: 2000, ...values })).toEqual({
      patch: {},
      issues: []
    })
    expect(values).not.toHaveProperty('id')
  })
  it('normalizes legacy version encoding and preserves the old wire CSV while storing its effective union', () => {
    const values = legacyReleaseWriteValues(legacy)
    expect(values).toMatchObject({
      ver: 110,
      target_version_code: 110,
      base_versions: '100,105',
      compatible_base_version_codes: '[110,100,105]',
      platform: legacy.platform,
      platforms: '["windows","linux"]',
      enable: 0,
      is_enabled: 0
    })
    expect(inspectBackfillRow('version', { id: 2000, ...values })).toEqual({
      patch: {},
      issues: []
    })
    expect(
      legacyReleaseWriteValues({ ...legacy, ver: '1.10.0' }).target_version_code
    ).toBe(1100)
  })
  it('retains NULL legacy flag and absent-CSV responses without changing their effective defaults', () => {
    const values = legacyReleaseWriteValues({
      ...legacy,
      enable: null,
      mandatory: null,
      showDialog: null,
      architecture: undefined,
      baseVersions: undefined
    })
    expect(values).toMatchObject({
      enable: null,
      is_enabled: 1,
      mandatory: null,
      is_mandatory: 1,
      show_dialog: null,
      show_update_dialog: 1,
      architecture: null,
      architectures: '[]',
      base_versions: null,
      compatible_base_version_codes: '[110]'
    })
    expect(inspectBackfillRow('version', { id: 2000, ...values })).toEqual({
      patch: {},
      issues: []
    })
  })
  it('does not let arbitrary request fields override authoritative columns', () => {
    const values = legacyReleaseWriteValues({
      ...legacy,
      id: 1,
      isEnabled: 1,
      targetVersionCode: 999,
      compatibleBaseVersionCodes: [999],
      createdAt: 'bad'
    })
    expect(values).not.toHaveProperty('id')
    expect(values.is_enabled).toBe(0)
    expect(values.target_version_code).toBe(110)
    expect(values.created_at).toEqual(input.createdAt)
  })
  it.each([
    { enable: 2 },
    { mandatory: 'yes' },
    { showDialog: -1 },
    { ver: 'bad' }
  ])('rejects unrepresentable legacy input: %j', change => {
    expect(() => legacyReleaseWriteValues({ ...legacy, ...change })).toThrow()
  })
  it('shares enable/disable mapping with policy writes', () => {
    expect(enabledWriteValues(false)).toEqual({ enable: 0, is_enabled: 0 })
    expect(enabledWriteValues(true)).toEqual({ enable: 1, is_enabled: 1 })
  })
  it('refuses repository writes outside the caller transaction', async () => {
    const repository = new DualWriteReleaseRepository()
    const runner = { isTransactionActive: false } as QueryRunner
    await expect(
      repository.insert(runner, {} as RegisteredApplication, input)
    ).rejects.toThrow('transaction')
    await expect(
      repository.setEnabled(
        runner,
        {} as RegisteredApplication,
        input.releaseId,
        true
      )
    ).rejects.toThrow('transaction')
  })
})
