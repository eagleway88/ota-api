import { Body, Controller, Post, VERSION_NEUTRAL } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '@/decorators'
import { LegacyUpdateCheckDto } from './update-check.dto'
import { LegacyUpdateCheckService } from '@/compat/legacy/update-check.service'

@ApiTags('legacy-update-check')
@Controller({ path: 'version', version: VERSION_NEUTRAL })
export class LegacyUpdateCheckController {
  constructor(private readonly service: LegacyUpdateCheckService) {}

  @Public()
  @Post('check')
  @ApiOperation({ summary: '兼容旧客户端检查更新' })
  check(@Body() body: LegacyUpdateCheckDto) {
    return this.service.check(body)
  }
}
