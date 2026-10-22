import { Body, Controller, Param, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { Public } from '@/decorators'
import { apiUtil } from '@/utils/api'
import { UpdateCheckService } from './update-check.service'
import { UpdateCheckDto } from './update-check.dto'

@ApiTags('app/updates')
@Controller('app/apps/:appName/updates')
export class UpdateCheckController {
  constructor(private readonly service: UpdateCheckService) {}
  @Public()
  @Post('check')
  @ApiOperation({ summary: '检查可用更新' })
  async check(@Param('appName') appName: string, @Body() body: UpdateCheckDto) {
    return apiUtil.data(await this.service.check(appName, body))
  }
}
