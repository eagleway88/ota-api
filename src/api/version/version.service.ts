
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { Request } from 'express'
import { apiUtil } from '@/utils/api'
import { ConfigService } from '@nestjs/config'
import { UpdaterUtil } from '@/utils/updater'
import { CheckDto, CreateDto, ErrorDto, SuccessDto, UploadDto } from './version.dto'
import { WsService } from '@/ws/ws.service'

@Injectable()
export class VersionService {
  private updater?: UpdaterUtil
  constructor(
    private readonly wsService: WsService,
    private readonly configService: ConfigService,
    @InjectDataSource() private dataSource: DataSource,
  ) {
    this.updater = new UpdaterUtil(this.configService)
  }

  async create(req: Request, body: CreateDto) {

    return apiUtil.data({})
  }

  async check(body: CheckDto) {
    return apiUtil.data({})
  }

  async upload(req: Request, file: any, body: UploadDto) {

    return apiUtil.data({})
  }

  async success(req: Request, body: SuccessDto) {

    return apiUtil.data({})
  }
  async error(req: Request, body: ErrorDto) {

    return apiUtil.data({})
  }
}
