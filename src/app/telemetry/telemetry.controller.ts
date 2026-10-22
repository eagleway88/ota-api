import {
  Body,
  Controller,
  Param,
  Post,
  Req,
  ValidationPipe
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'
import { Public } from '@/decorators'
import { apiUtil } from '@/utils/api'
import { fetchIP } from '@/utils'
import { TelemetryWriteService } from '@/telemetry/telemetry-write.service'
import {
  ApplicationErrorReportDto,
  FailureReportDto,
  StatusReportDto
} from '@/app/telemetry/telemetry.dto'

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
})

@ApiTags('client-reports')
@Controller('app/apps/:appName/telemetry')
export class TelemetryWriteController {
  constructor(private readonly service: TelemetryWriteService) {}

  @Public()
  @Post('successes')
  @ApiOperation({ summary: '上报实际安装成功' })
  async success(
    @Req() request: Request,
    @Param('appName') appName: string,
    @Body(validation) body: StatusReportDto
  ) {
    return apiUtil.data(
      await this.service.success({
        ...body,
        appName,
        sourceIp: fetchIP(request)
      })
    )
  }

  @Public()
  @Post('failures')
  @ApiOperation({ summary: '上报更新失败' })
  async failure(
    @Req() request: Request,
    @Param('appName') appName: string,
    @Body(validation) body: FailureReportDto
  ) {
    return apiUtil.data(
      await this.service.failure({
        ...body,
        appName,
        sourceIp: fetchIP(request)
      })
    )
  }

  @Public()
  @Post('app-errors')
  @ApiOperation({ summary: '上报应用运行错误' })
  async applicationError(
    @Req() request: Request,
    @Param('appName') appName: string,
    @Body(validation) body: ApplicationErrorReportDto
  ) {
    return apiUtil.data(
      await this.service.applicationError({
        ...body,
        appName,
        sourceIp: fetchIP(request)
      })
    )
  }
}
