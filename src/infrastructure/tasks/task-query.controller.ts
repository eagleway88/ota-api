import { Controller, Get, Param, Query, ValidationPipe } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import { AdminTimeQueryDto } from '@/contracts/admin-query.dto'
import { TaskLogQueryDto, TaskQueryDto } from './task-query.dto'
import { TaskQueryService } from './task-query.service'

const validation = new ValidationPipe({
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true
})

@ApiTags('publish-tasks')
@ApiBearerAuth()
@Controller('v2/apps/:appName')
export class TaskQueryController {
  constructor(private readonly service: TaskQueryService) {}

  @Get('tasks')
  @ApiOperation({ summary: '分页查询发布任务，按创建时间筛选' })
  list(
    @Param('appName') appName: string,
    @Query(validation) query: TaskQueryDto
  ) {
    return this.service.list(appName, query)
  }

  @Get('tasks/:taskId')
  @ApiOperation({ summary: '查询任务和最后一次执行记录' })
  detail(@Param('appName') appName: string, @Param('taskId') taskId: string) {
    return this.service.detail(appName, taskId)
  }

  @Get('tasks/:taskId/logs')
  @ApiOperation({ summary: '分页查询任务执行日志，按开始时间筛选' })
  logs(
    @Param('appName') appName: string,
    @Param('taskId') taskId: string,
    @Query(validation) query: TaskLogQueryDto
  ) {
    return this.service.logs(appName, taskId, query)
  }

  @Get('releases/:releaseId/delivery')
  @ApiOperation({
    summary: '查询版本触发的任务及最后执行摘要；不代表该版本的独立接收人数'
  })
  delivery(
    @Param('appName') appName: string,
    @Param('releaseId') releaseId: string,
    @Query(validation) query: AdminTimeQueryDto
  ) {
    return this.service.delivery(appName, releaseId, query)
  }
}
