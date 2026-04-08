import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { SendUserIdDto, SendUniqueIdDto } from './message.dto'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'

@Injectable()
export class LastMessageService {
  constructor(
    @InjectRepository(UserIdMessage)
    private readonly tUserId: Repository<UserIdMessage>,
    @InjectRepository(UniqueIdMessage)
    private readonly tUniqueId: Repository<UniqueIdMessage>,
  ) { }

  async queryUserId(body: SendUserIdDto) {
    return this.tUserId.findOneBy({
      userId: body.userId
    })
  }

  async createUserId(body: SendUserIdDto) {
    await this.deleteUserId(body)
    const entity = new UserIdMessage()
    entity.userId = body.userId
    entity.content = typeof body.data !== 'string' ? JSON.stringify(body.data) : body.data
    return this.tUserId.save(entity)
  }

  async deleteUserId(body: SendUserIdDto) {
    const entity = await this.queryUserId(body)
    if (!entity) return
    await this.tUserId.remove(entity)
  }

  async queryUniqueId(body: SendUniqueIdDto) {
    return this.tUniqueId.findOneBy({
      uniqueId: body.uniqueId
    })
  }

  async createUniqueId(body: SendUniqueIdDto) {
    await this.deleteUniqueId(body)
    const entity = new UniqueIdMessage()
    entity.uniqueId = body.uniqueId
    entity.content = typeof body.data !== 'string' ? JSON.stringify(body.data) : body.data
    return this.tUniqueId.save(entity)
  }

  async deleteUniqueId(body: SendUniqueIdDto) {
    const entity = await this.queryUniqueId(body)
    if (!entity) return
    await this.tUniqueId.remove(entity)
  }
}
