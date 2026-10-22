import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  ApplicationErrorQueryDto,
  TelemetryQueryDto
} from '@/manage/statistics/statistics.dto'
import { TelemetryQueryService } from '@/manage/statistics/statistics.service'

const queryValidation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
})

@ApiTags('manage/statistics')
@ApiBearerAuth()
@Controller('manage/apps/:appName')
export class TelemetryController {
  constructor(private readonly service: TelemetryQueryService) {}

  @Get('statistics/summary')
  @ApiOperation({ summary: '更新成功/失败上报记录数（不是独立用户数）' })
  summary(
    @Param('appName') appName: string,
    @Query(queryValidation) query: TelemetryQueryDto
  ) {
    return this.service.summary(appName, query)
  }

  @Get('telemetry/successes')
  @ApiOperation({ summary: '分页查询安装成功上报' })
  successes(
    @Param('appName') appName: string,
    @Query(queryValidation) query: TelemetryQueryDto
  ) {
    return this.service.reports(appName, 'success', query)
  }

  @Get('telemetry/failures')
  @ApiOperation({ summary: '分页查询更新失败上报' })
  failures(
    @Param('appName') appName: string,
    @Query(queryValidation) query: TelemetryQueryDto
  ) {
    return this.service.reports(appName, 'error', query)
  }

  @Get('telemetry/app-errors')
  @ApiOperation({ summary: '分页查询客户端错误聚合，按最后发生时间筛选' })
  appErrors(
    @Param('appName') appName: string,
    @Query(queryValidation) query: ApplicationErrorQueryDto
  ) {
    return this.service.appErrors(appName, query)
  }
}
