import { Body, Controller, Get, Param, Post } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult } from '@/decorators'
import { RequirePermission } from '@/auth/api-key.policy'
import { MessageService } from './messages.service'
import {
  SendMessageDto,
  SendUserIdDto,
  SendUniqueIdDto,
  SendUserIdRes,
  SendUniqueIdRes
} from './messages.dto'

@ApiTags('manage/messages')
@ApiBearerAuth()
@RequirePermission('messages:send')
@Controller('manage/apps/:appName/messages')
export class MessageController {
  constructor(private readonly service: MessageService) {}
  @Get('user-id-subscriptions')
  @ApiOperation({ summary: '查询本应用在线用户订阅' })
  @ApiResult({ type: [String], status: 200 })
  @RequirePermission('messages:read')
  listSubscribedUserIds(@Param('appName') appName: string) {
    return this.service.listSubscribedUserIds(appName)
  }
  @Post('application')
  @ApiOperation({ summary: '发送本应用普通消息（非 OTA 重推）' })
  @ApiResult({ type: String })
  sendApplication(
    @Param('appName') appName: string,
    @Body() body: SendMessageDto
  ) {
    return this.service.sendApplication(appName, body)
  }
  @Post('users')
  @ApiOperation({ summary: '发送本应用指定用户消息' })
  @ApiResult({ type: SendUserIdRes })
  sendUserId(@Param('appName') appName: string, @Body() body: SendUserIdDto) {
    return this.service.sendUserId(appName, body)
  }
  @Post('devices')
  @ApiOperation({ summary: '发送本应用指定设备消息' })
  @ApiResult({ type: SendUniqueIdRes })
  sendUniqueId(
    @Param('appName') appName: string,
    @Body() body: SendUniqueIdDto
  ) {
    return this.service.sendUniqueId(appName, body)
  }
}
