import { MODULE_METADATA } from '@nestjs/common/constants'
import { AdminModule } from '@/compat/legacy/http/admin/admin.module'
import { MessageModule } from '@/compat/legacy/http/message/message.module'
import { VersionModule } from '@/compat/legacy/http/version/version.module'
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
