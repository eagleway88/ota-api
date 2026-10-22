import {
  Controller,
  Param,
  Post,
  Req,
  UploadedFile,
  UseInterceptors
} from '@nestjs/common'
import { FileInterceptor } from '@nestjs/platform-express'
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger'
import { ArtifactService } from '@/infrastructure/oss/artifact.service'
import { administratorContext } from '@/middleware/request-context'
import type { AdministratorRequest } from '@/middleware/request-context'

@ApiTags('manage/artifacts')
@ApiBearerAuth()
@Controller('manage/apps/:appName/artifacts')
export class ArtifactsController {
  constructor(private readonly service: ArtifactService) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Req() request: AdministratorRequest,
    @Param('appName') appName: string,
    @UploadedFile() file?: Express.Multer.File
  ) {
    return this.service.uploadArtifact(
      appName,
      file,
      administratorContext(request)
    )
  }
}
