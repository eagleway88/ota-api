import { Controller, Get, Query } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ReleaseListQueryDto } from '@/releases/release-management.dto'
import { AdminAuditService } from './admin-audit.service'

@ApiTags('admin-audit')
@ApiBearerAuth()
@Controller('v2/admin/audit-logs')
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  list(@Query() query: ReleaseListQueryDto) {
    return this.service.list(query)
  }
}
