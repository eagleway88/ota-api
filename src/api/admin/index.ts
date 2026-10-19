import { Body, Controller, Post, Req } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { AdminService } from './admin.service'
import { Admin } from '@/entities/admin.entity'
import { AdminDto } from './admin.dto'
import type { Request } from 'express'
import { randomUUID } from 'crypto'
import { fetchIP } from '@/utils'

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) {}

  @Public()
  @Post('create')
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
