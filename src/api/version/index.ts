import { Body, Controller, Post } from '@nestjs/common'
import { Req, UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiConsumes } from '@nestjs/swagger'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { VersionService } from './version.service'
import { ApiResult, Public } from '@/decorators'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  AppErrorLogDto,
  CheckDto,
  CreateDto,
  ErrorDto,
  VersionDto,
  SuccessDto,
  UploadDto
} from './version.dto'

@ApiTags('version')
@Controller('version')
export class VersionController {
  constructor(private readonly service: VersionService) { }

  @Public()
  @Post('check')
  @ApiOperation({ summary: '检查更新' })
  @ApiResult({ type: VersionDto })
  check(@Body() body: CheckDto) {
    return this.service.check(body)
  }

  @Public()
  @Post('success')
  @ApiOperation({ summary: '上报更新成功' })
  @ApiResult({ type: String })
  success(@Req() req: Request, @Body() body: SuccessDto) {
    return this.service.success(req, body)
  }

  @Public()
  @Post('error')
  @ApiOperation({ summary: '上报更新失败' })
  @ApiResult({ type: String })
  error(@Req() req: Request, @Body() body: ErrorDto) {
    return this.service.error(req, body)
  }

  @Public()
  @Post('app-error')
  @ApiOperation({ summary: '上报应用闪退或运行时错误' })
  @ApiResult({ type: AppErrorLogDto })
  appError(@Req() req: Request, @Body() body: AppErrorLogDto) {
    return this.service.appError(req, body)
  }

  @Post('create')
  @ApiBearerAuth()
  @ApiOperation({ summary: '创建全量更新版本' })
  @ApiResult({ type: VersionDto })
  create(@Req() req: Request, @Body() body: CreateDto) {
    return this.service.create(req, body)
  }

  @Post('upload')
  @ApiBearerAuth()
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传热更新资源' })
  @ApiResult({ type: VersionDto })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() req: Request,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: UploadDto
  ) {
    return this.service.upload(req, file, body)
  }
}
