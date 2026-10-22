import { Controller, Param, Post, Req } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { ReleaseManagementService } from '@/releases/release-management.service'
import { administratorContext } from '@/middleware/request-context'
import type { AdministratorRequest } from '@/middleware/request-context'

@ApiTags('manage/applications')
@ApiBearerAuth()
@Controller('manage/apps')
export class ApplicationsController {
  constructor(private readonly service: ReleaseManagementService) {}

  @Post(':appName/prepare')
  prepare(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string
  ) {
    return this.service.prepare(appName, administratorContext(request))
  }
}
