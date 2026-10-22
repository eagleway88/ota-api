import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req
} from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { administratorContext } from '@/middleware/request-context'
import type { AdministratorRequest } from '@/middleware/request-context'
import { ReleaseManagementService } from '@/releases/release-management.service'
import {
  ChangeReleaseScopeDto,
  ReleaseCatalogListQueryDto,
  ReplaceReleaseUsersDto
} from '@/releases/release-management.dto'
import { ReleaseDraftService } from '@/releases/release-draft.service'
import {
  CreateReleaseDraftDto,
  UpdateReleaseDraftDto
} from '@/releases/release-draft.dto'

@ApiTags('manage/releases')
@ApiBearerAuth()
@Controller('manage/apps/:appName/releases')
export class ReleaseManagementController {
  constructor(
    private readonly service: ReleaseManagementService,
    private readonly drafts: ReleaseDraftService
  ) {}

  @Get()
  list(
    @Param('appName') appName: string,
    @Query() query: ReleaseCatalogListQueryDto
  ) {
    return this.drafts.list(appName, query)
  }

  @Post()
  createDraft(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Body() body: CreateReleaseDraftDto
  ) {
    const idempotencyKey = request.headers['idempotency-key']
    return this.drafts.createDraft(
      appName,
      body,
      typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      administratorContext(request)
    )
  }

  @Get(':releaseId')
  detail(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.detail(appName, releaseId)
  }

  @Patch(':releaseId')
  updateDraft(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: UpdateReleaseDraftDto
  ) {
    return this.drafts.updateDraft(
      appName,
      releaseId,
      body,
      administratorContext(request)
    )
  }

  @Post(':releaseId/publish')
  publish(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.publish(
      appName,
      releaseId,
      administratorContext(request)
    )
  }

  @Get(':releaseId/users')
  users(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.users(appName, releaseId)
  }

  @Put(':releaseId/users')
  replaceUsers(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ReplaceReleaseUsersDto
  ) {
    return this.service.replaceUsers(
      appName,
      releaseId,
      body,
      administratorContext(request)
    )
  }

  @Patch(':releaseId/scope')
  changeScope(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ChangeReleaseScopeDto
  ) {
    return this.service.changeScope(
      appName,
      releaseId,
      body,
      administratorContext(request)
    )
  }

  @Post(':releaseId/disable')
  disable(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      false,
      administratorContext(request)
    )
  }

  @Post(':releaseId/enable')
  enable(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      true,
      administratorContext(request)
    )
  }

  @Post(':releaseId/redispatch')
  redispatch(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.redispatch(
      appName,
      releaseId,
      administratorContext(request)
    )
  }
}
