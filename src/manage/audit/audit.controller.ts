import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import {
  ApplicationAuditQueryDto,
  AuditQueryDto
} from '@/manage/audit/audit.dto'
import { AuditQueryService } from '@/manage/audit/audit.service'

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
})

@ApiTags('manage/audit')
@ApiBearerAuth()
@Controller('manage')
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}

  @Get('audit-logs')
  @ApiOperation({ summary: '分页查询全局管理员审计' })
  global(@Query(validation) query: AuditQueryDto) {
    return this.service.listGlobal(query)
  }

  @Get('apps/:appName/audit-logs')
  @ApiOperation({ summary: '分页查询应用管理审计' })
  application(
    @Param('appName') appName: string,
    @Query(validation) query: ApplicationAuditQueryDto
  ) {
    return this.service.listApplication(appName, query)
  }
}
