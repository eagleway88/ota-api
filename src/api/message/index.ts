import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Post,
  Query,
  Req
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { MessageService } from './message.service'
import { SendGlobalDto, SendOtaNameDto } from './message.dto'
import { SendUserIdDto, SendUniqueIdDto } from './message.dto'
import { SendUserIdRes, SendUniqueIdRes } from './message.dto'
import type { Request } from 'express'

@ApiTags('message')
@Controller('message')
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Get('user-id-subscriptions')
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取所有userId订阅' })
  @ApiQuery({ name: 'name', required: false, type: String })
  @ApiResult({ type: [String], status: HttpStatus.OK })
  listSubscribedUserIds(@Query('name') name?: string) {
    return this.service.listSubscribedUserIds(name)
  }

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
  @ApiResult({ type: SendUserIdRes })
  sendUserId(@Req() req: Request, @Body() body: SendUserIdDto) {
    return this.service.sendUserId(req, body)
  }

  @Public()
  @Post('send-unique-id')
  @ApiOperation({ summary: '发送特定设备通知' })
  @ApiResult({ type: SendUniqueIdRes })
  sendUniqueId(@Req() req: Request, @Body() body: SendUniqueIdDto) {
    return this.service.sendUniqueId(req, body)
  }
}
