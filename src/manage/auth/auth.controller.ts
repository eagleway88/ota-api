import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { AdminService } from '@/auth/administrator.service'
import { Admin } from '@/entities/admin.entity'
import { AdminDto } from '@/auth/auth.dto'
import type { Request } from 'express'
import { randomUUID } from 'crypto'
import { fetchIP } from '@/utils'

@ApiTags('admin')
@Controller('manage/auth')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Public()
  @Post('initialize')
  @ApiOperation({ summary: '管理员创建' })
  @ApiResult({ type: Admin })
  create(@Req() request: Request, @Body() body: AdminDto) {
    return this.service.create(body, {
      requestId: String(request.headers['x-request-id'] || randomUUID()),
      sourceIp: fetchIP(request)
    })
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '管理员登录' })
  @ApiResult({ type: String })
  login(@Body() body: AdminDto) {
    return this.service.login(body)
  }
}
