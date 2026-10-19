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
import { UploadedFile, UseInterceptors } from '@nestjs/common'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { FileInterceptor } from '@nestjs/platform-express'
import type { Request } from 'express'
import { randomUUID } from 'crypto'
import { fetchIP } from '@/utils'
import { ReleaseManagementService } from './release-management.service'
import {
  ChangeReleaseScopeDto,
  AuditListQueryDto,
  ReleaseListQueryDto,
  ReplaceReleaseUsersDto,
  TaskListQueryDto
} from './release-management.dto'
import { ReleaseDraftService } from './release-draft.service'
import {
  CreateReleaseDraftDto,
  UpdateReleaseDraftDto
} from './release-draft.dto'

type AuthenticatedRequest = Request & {
  user?: { sub?: number; uid?: number; username?: string }
}

@ApiTags('release-management')
@ApiBearerAuth()
@Controller('v2/apps/:appName')
export class ReleaseManagementController {
  constructor(
    private readonly service: ReleaseManagementService,
    private readonly drafts: ReleaseDraftService
  ) {}

  @Post('prepare')
  prepare(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string
  ) {
    return this.service.prepare(appName, this.context(request))
  }

  @Get('releases')
  list(@Param('appName') appName: string, @Query() query: ReleaseListQueryDto) {
    return this.drafts.list(appName, query)
  }

  @Post('artifacts')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  uploadArtifact(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    return this.drafts.uploadArtifact(appName, file, this.context(request))
  }

  @Post('releases')
  createDraft(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Body() body: CreateReleaseDraftDto
  ) {
    const idempotencyKey = request.headers['idempotency-key']
    return this.drafts.createDraft(
      appName,
      body,
      typeof idempotencyKey === 'string' ? idempotencyKey : undefined,
      this.context(request)
    )
  }

  @Get('releases/:releaseId')
  detail(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.detail(appName, releaseId)
  }

  @Patch('releases/:releaseId')
  updateDraft(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: UpdateReleaseDraftDto
  ) {
    return this.drafts.updateDraft(
      appName,
      releaseId,
      body,
      this.context(request)
    )
  }

  @Post('releases/:releaseId/publish')
  publish(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.drafts.publish(appName, releaseId, this.context(request))
  }

  @Get('releases/:releaseId/users')
  users(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.users(appName, releaseId)
  }

  @Put('releases/:releaseId/users')
  replaceUsers(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ReplaceReleaseUsersDto
  ) {
    return this.service.replaceUsers(
      appName,
      releaseId,
      body,
      this.context(request)
    )
  }

  @Patch('releases/:releaseId/scope')
  changeScope(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Body() body: ChangeReleaseScopeDto
  ) {
    return this.service.changeScope(
      appName,
      releaseId,
      body,
      this.context(request)
    )
  }

  @Post('releases/:releaseId/disable')
  disable(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      false,
      this.context(request)
    )
  }

  @Post('releases/:releaseId/enable')
  enable(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.setEnabled(
      appName,
      releaseId,
      true,
      this.context(request)
    )
  }

  @Post('releases/:releaseId/redispatch')
  redispatch(
    @Req() request: AuthenticatedRequest,
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.redispatch(appName, releaseId, this.context(request))
  }

  @Get('releases/:releaseId/delivery')
  delivery(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string
  ) {
    return this.service.delivery(appName, releaseId)
  }

  @Get('tasks')
  tasks(@Param('appName') appName: string, @Query() query: TaskListQueryDto) {
    return this.service.tasks(appName, query)
  }

  @Get('tasks/:taskId')
  task(@Param('appName') appName: string, @Param('taskId') taskId: string) {
    return this.service.task(appName, taskId)
  }

  @Get('tasks/:taskId/logs')
  taskLogs(
    @Param('appName') appName: string,
    @Param('taskId') taskId: string,
    @Query() query: ReleaseListQueryDto
  ) {
    return this.service.taskLogs(appName, taskId, query)
  }

  @Get('audit-logs')
  auditLogs(
    @Param('appName') appName: string,
    @Query() query: AuditListQueryDto
  ) {
    return this.service.auditLogs(appName, query)
  }

  private context(request: AuthenticatedRequest) {
    return {
      requestId: String(request.headers['x-request-id'] || randomUUID()),
      sourceIp: fetchIP(request),
      actorAdminId: Number(request.user?.sub ?? request.user?.uid) || undefined,
      actorName: request.user?.username
    }
  }
}
