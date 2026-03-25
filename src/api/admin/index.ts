import { Body, Controller, Post } from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { AdminService } from './admin.service'
import { Admin } from '@/entities/admin.entity'
import { AdminDto } from './admin.dto'

@ApiTags('admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly service: AdminService) { }

  @Public()
  @Post('create')
  @ApiOperation({ summary: '管理员创建' })
  @ApiResult({ type: Admin })
  create(@Body() body: AdminDto) {
    return this.service.create(body)
  }

  @Public()
  @Post('login')
  @ApiOperation({ summary: '管理员登录' })
  @ApiResult({ type: String })
  login(@Body() body: AdminDto) {
    return this.service.login(body)
  }
}
