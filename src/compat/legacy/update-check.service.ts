import { Injectable } from '@nestjs/common'
import { apiUtil } from '@/utils/api'
import { userIdMatchesContext } from '@/contracts/user-id'
import { normalizeVersionValue } from '@/utils/version'
import { LegacyUpdateCheckDto } from './update-check.dto'
import { UpdateQueryService } from '@/updates/update-query.service'

@Injectable()
export class LegacyUpdateCheckService {
  constructor(private readonly query: UpdateQueryService) {}

  async check(body: LegacyUpdateCheckDto) {
    const version =
      typeof body.ver === 'string'
        ? (normalizeVersionValue(body.ver) ??
          Number(body.ver.replaceAll('.', '')))
        : body.ver
    if (
      body.userId &&
      !userIdMatchesContext(body.userId, body.name, body.platform)
    ) {
      return apiUtil.error('Invalid userId for application or platform')
    }
    return apiUtil.data(
      await this.query.findLatestAvailableVersion({
        name: body.name,
        platform: body.platform,
        ver: version,
        channel: body.channel,
        architecture: body.architecture,
        id: body.id,
        userIds: body.userId ? [body.userId] : undefined
      })
    )
  }
}
