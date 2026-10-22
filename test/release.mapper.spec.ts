import {
  mapLegacyReleaseRecord,
  serializeLegacyRelease
} from '@/compat/legacy/release.mapper'

describe('release legacy mapper', () => {
  it('prefers formal storage columns while preserving old output fields', () => {
    const release = mapLegacyReleaseRecord({
      id: 2000,
      release_id: 'release-1',
      name: 'app',
      ver: 100,
      target_version_code: 110,
      base_versions: '100',
      compatible_base_version_codes: [100, 101],
      platform: 'windows',
      platforms: ['windows', 'linux'],
      architecture: 'x64',
      architectures: ['arm64'],
      enable: 1,
      is_enabled: 0,
      mandatory: 0,
      is_mandatory: 1,
      show_dialog: 0,
      show_update_dialog: 1,
      update_type: 'hot',
      package_url: 'https://example.test/legacy.zip'
    })

    expect(release).toEqual(
      expect.objectContaining({
        targetVersionCode: 110,
        compatibleBaseVersionCodes: [100, 101],
        platforms: ['windows', 'linux'],
        architectures: ['arm64'],
        enabled: false,
        mandatory: true,
        showUpdateDialog: true
      })
    )
    expect(serializeLegacyRelease(release, true, true)).toEqual(
      expect.objectContaining({
        id: 2000,
        ver: 100,
        platform: 'windows',
        architecture: 'x64',
        enable: 1,
        mandatory: 1,
        showDialog: 1
      })
    )
  })
})
