import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { CheckDto, VersionDto } from './version.dto'
import { VersionCheckService } from './version-check.service'

@ApiTags('legacy-update-check')
@Controller('version')
export class VersionController {
  constructor(private readonly service: VersionCheckService) {}

  @Public()
  @Post('check')
  @ApiOperation({ summary: '兼容旧客户端检查更新' })
  @ApiResult({ type: VersionDto })
  check(@Body() body: CheckDto) {
    return this.service.check(body)
  }
}
