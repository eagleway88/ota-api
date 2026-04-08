import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { MessageService } from './message.service'
import { SendGlobalDto, SendOtaNameDto } from './message.dto'
import { SendUserIdDto, SendUniqueIdDto } from './message.dto'
import type { Request } from 'express'

@ApiTags('message')
@Controller('message')
export class MessageController {
  constructor(private readonly service: MessageService) { }

  @Public()
  @Post('send-global')
  @ApiOperation({ summary: '发送全局通知' })
  @ApiResult({ type: String })
  sendGlobal(@Req() req: Request, @Body() body: SendGlobalDto) {
    return this.service.sendGlobal(req, body)
  }

  @Public()
  @Post('send-ota-name')
  @ApiOperation({ summary: '发送OTA通知' })
  @ApiResult({ type: String })
  sendOtaName(@Req() req: Request, @Body() body: SendOtaNameDto) {
    return this.service.sendOtaName(req, body)
  }

  @Public()
  @Post('send-user-id')
  @ApiOperation({ summary: '发送特定用户通知' })
  @ApiResult({ type: String })
  sendUserId(@Req() req: Request, @Body() body: SendUserIdDto) {
    return this.service.sendUserId(req, body)
  }

  @Public()
  @Post('send-unique-id')
  @ApiOperation({ summary: '发送特定设备通知' })
  @ApiResult({ type: String })
  sendUniqueId(@Req() req: Request, @Body() body: SendUniqueIdDto) {
    return this.service.sendUniqueId(req, body)
  }
}
