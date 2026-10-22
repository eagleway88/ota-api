import { BadRequestException, Injectable } from '@nestjs/common'
import { UpdateQueryService } from '@/updates/update-query.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'
import { userIdMatchesContext } from '@/contracts/user-id'
import { UpdateCheckDto } from './update-check.dto'

@Injectable()
export class UpdateCheckService {
  constructor(private readonly query: UpdateQueryService) {}
  check(appName: string, body: UpdateCheckDto) {
    new ApplicationTableResolver().validateAppName(appName)
    if (
      body.userId !== undefined &&
      !userIdMatchesContext(body.userId, appName, body.platform)
    )
      throw new BadRequestException(
        'userId must match the application and platform'
      )
    return this.query.findLatestAvailableVersion({
      ...body,
      appName,
      userIds: body.userId ? [body.userId] : []
    })
  }
}
