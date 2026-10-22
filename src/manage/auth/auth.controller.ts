import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  UnauthorizedException
} from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApiResult, Public } from '@/decorators'
import { AdministratorService } from '@/auth/administrator.service'
import {
  LoginDto,
  AdministratorDto,
  AdministratorSessionDto,
  InitializeAdministratorDto
} from '@/auth/auth.dto'
import { AuthService } from '@/auth/auth.service'
import { administratorContext } from '@/middleware/request-context'
import type { AdministratorRequest } from '@/middleware/request-context'
import { apiUtil } from '@/utils/api'

@ApiTags('manage/auth')
@Controller('manage/auth')
export class AuthController {
  constructor(
    private readonly service: AdministratorService,
    private readonly auth: AuthService
  ) {}

  @Public()
  @Post('initialize')
  @ApiOperation({ summary: '管理员创建' })
  @ApiResult({ type: AdministratorDto })
  create(
    @Req() request: AdministratorRequest,
    @Body() body: InitializeAdministratorDto,
    @Headers('x-initialization-token') token?: string
  ) {
    this.auth.assertInitializationToken(token)
    return this.service.create(body, administratorContext(request))
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '管理员登录' })
  @ApiResult({ type: AdministratorSessionDto, status: 200 })
  login(@Req() request: AdministratorRequest, @Body() body: LoginDto) {
    return this.service.login(body, administratorContext(request))
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiResult({ type: AdministratorDto, status: 200 })
  me(@Req() request: AdministratorRequest) {
    if (!request.user) throw new UnauthorizedException()
    return apiUtil.data({
      id: request.user.sub,
      username: request.user.username
    })
  }

  @Post('logout')
  @ApiBearerAuth()
  @HttpCode(200)
  async logout(@Req() request: AdministratorRequest) {
    if (!request.user) throw new UnauthorizedException()
    await this.auth.revoke(request.user, administratorContext(request))
    return apiUtil.data(null)
  }

  @Post('logout-all')
  @ApiBearerAuth()
  @HttpCode(200)
  async logoutAll(@Req() request: AdministratorRequest) {
    if (!request.user) throw new UnauthorizedException()
    await this.auth.revoke(request.user, administratorContext(request), true)
    return apiUtil.data(null)
  }
}
