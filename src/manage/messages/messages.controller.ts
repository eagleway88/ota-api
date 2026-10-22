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
import { ApiResult } from '@/decorators'
import { MessageService } from '@/manage/messages/messages.service'
import {
  MessageSubscriptionsQueryDto,
  SendGlobalDto,
  SendApplicationDto
} from '@/manage/messages/messages.dto'
import { SendUserIdDto, SendUniqueIdDto } from '@/manage/messages/messages.dto'
import { SendUserIdRes, SendUniqueIdRes } from '@/manage/messages/messages.dto'
import type { Request } from 'express'

@ApiTags('manage/messages')
@ApiBearerAuth()
@Controller('manage/messages')
export class MessageController {
  constructor(private readonly service: MessageService) {}

  @Get('user-id-subscriptions')
  @ApiOperation({ summary: '获取所有userId订阅' })
  @ApiQuery({ name: 'appName', required: false, type: String })
  @ApiResult({ type: [String], status: HttpStatus.OK })
  listSubscribedUserIds(
    @Req() req: Request,
    @Query() query: MessageSubscriptionsQueryDto
  ) {
    return this.service.listSubscribedUserIds(req, query.appName)
  }

  @Post('global')
  @ApiOperation({ summary: '发送全局通知' })
  @ApiResult({ type: String })
  sendGlobal(@Req() req: Request, @Body() body: SendGlobalDto) {
    return this.service.sendGlobal(req, body)
  }

  @Post('applications')
  @ApiOperation({ summary: '发送普通应用消息' })
  @ApiResult({ type: String })
  sendApplication(@Req() req: Request, @Body() body: SendApplicationDto) {
    return this.service.sendApplication(req, body)
  }

  @Post('users')
  @ApiOperation({ summary: '发送特定用户通知' })
  @ApiResult({ type: SendUserIdRes })
  sendUserId(@Req() req: Request, @Body() body: SendUserIdDto) {
    return this.service.sendUserId(req, body)
  }

  @Post('devices')
  @ApiOperation({ summary: '发送特定设备通知' })
  @ApiResult({ type: SendUniqueIdRes })
  sendUniqueId(@Req() req: Request, @Body() body: SendUniqueIdDto) {
    return this.service.sendUniqueId(req, body)
  }
}
