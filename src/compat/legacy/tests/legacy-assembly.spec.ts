import { MODULE_METADATA } from '@nestjs/common/constants'
import { AdminModule } from '@/api/admin/admin.module'
import { MessageModule } from '@/api/message/message.module'
import { VersionModule } from '@/api/version/version.module'
import { LegacyCompatibilityModule } from '../legacy.module'

describe('LegacyCompatibilityModule', () => {
  it('is the single assembly point for retained legacy endpoint modules', () => {
    const imports = Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      LegacyCompatibilityModule
    ) as unknown[]

    expect(imports).toEqual([AdminModule, MessageModule, VersionModule])
  })
})
