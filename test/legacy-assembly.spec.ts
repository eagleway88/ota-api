import { MODULE_METADATA } from '@nestjs/common/constants'
import { LegacyUpdateCheckModule } from '@/compat/legacy/update-check.module'
import { LegacyCompatibilityModule } from '@/compat/legacy'

describe('LegacyCompatibilityModule', () => {
  it('loads only the legacy update check module', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LegacyCompatibilityModule
    ) as unknown[]

    expect(imports).toEqual([LegacyUpdateCheckModule])
  })
})
