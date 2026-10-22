import { MODULE_METADATA } from '@nestjs/common/constants'
import { VersionModule } from '@/compat/legacy/http/version/version.module'
import { LegacyCompatibilityModule } from '../legacy.module'

describe('LegacyCompatibilityModule', () => {
  it('loads only the legacy update check module', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LegacyCompatibilityModule
    ) as unknown[]

    expect(imports).toEqual([VersionModule])
  })
})
