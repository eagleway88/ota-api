import { RequirePermission } from '@/auth/api-key.policy'
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
import { operationContext } from '@/middleware/request-context'
import type { ApiRequest } from '@/middleware/request-context'
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
@RequirePermission('releases:write')
@Controller('manage/apps/:appName/releases')
export class ReleaseManagementController {
  constructor(
    private readonly service: ReleaseManagementService,
    private readonly drafts: ReleaseDraftService
  ) {}

  @Get()
  @RequirePermission('releases:read')
  list(
    @Param('appName') appName: string,
    @Query() query: ReleaseCatalogListQueryDto
  ) {
    return this.drafts.list(appName, query)
  }

  @Post()
  createDraft(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Body() body: CreateReleaseDraftDto
  ) {
    const idempotencyKey = request.headers['idempotency-key']
    return this.drafts.createDraft(
      appName,
      body,
      typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      operationContext(request)
    )
  }

  @Get(':releaseId')
  @RequirePermission('releases:read')
  detail(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.detail(appName, releaseId)
  }

  @Patch(':releaseId')
  updateDraft(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: UpdateReleaseDraftDto
  ) {
    return this.drafts.updateDraft(
      appName,
      releaseId,
      body,
      operationContext(request)
    )
  }

  @Post(':releaseId/publish')
  publish(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.publish(appName, releaseId, operationContext(request))
  }

  @Get(':releaseId/users')
  @RequirePermission('releases:read')
  users(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.users(appName, releaseId)
  }

  @Put(':releaseId/users')
  replaceUsers(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ReplaceReleaseUsersDto
  ) {
    return this.service.replaceUsers(
      appName,
      releaseId,
      body,
      operationContext(request)
    )
  }

  @Patch(':releaseId/scope')
  changeScope(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ChangeReleaseScopeDto
  ) {
    return this.service.changeScope(
      appName,
      releaseId,
      body,
      operationContext(request)
    )
  }

  @Post(':releaseId/disable')
  disable(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      false,
      operationContext(request)
    )
  }

  @Post(':releaseId/enable')
  enable(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      true,
      operationContext(request)
    )
  }

  @Post(':releaseId/redispatch')
  redispatch(
    @Req() request: ApiRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.redispatch(
      appName,
      releaseId,
      operationContext(request)
    )
  }
}
