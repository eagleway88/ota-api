import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { NotifyService } from './notify.service'
import { SendDto } from './notify.dto'
import type { Request } from 'express'

@ApiTags('notify')
@Controller('notify')
export class NotifyController {
  constructor(private readonly service: NotifyService) { }

  @Public()
  @Post('send')
  @ApiOperation({ summary: '发送通知' })
  @ApiResult({ type: String })
  send(@Req() req: Request, @Body() body: SendDto) {
    return this.service.send(req, body)
  }

  @Public()
  @Post('uid')
  @ApiOperation({ summary: '发送通知(特定用户)' })
  @ApiResult({ type: String })
  uid(@Req() req: Request, @Body() body: SendDto) {
    return this.service.uid(req, body)
  }
}
