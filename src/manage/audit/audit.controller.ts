import { RequirePermission } from '@/auth/api-key.policy'
import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { ApplicationAuditQueryDto } from '@/manage/audit/audit.dto'
import { AuditQueryService } from '@/manage/audit/audit.service'

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
})

@ApiTags('manage/audit')
@ApiBearerAuth()
@RequirePermission('audit:read')
@Controller('manage')
export class AuditController {
  constructor(private readonly service: AuditQueryService) {}

  @Get('apps/:appName/audit-logs')
  @ApiOperation({ summary: '分页查询应用管理审计' })
  application(
    @Param('appName') appName: string,
    @Query(validation) query: ApplicationAuditQueryDto
  ) {
    return this.service.listApplication(appName, query)
  }
}
