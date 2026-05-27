import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'crypto'
import { SendUserIdDto, TargetedMessageEnvelope } from './message.dto'
import { AckUniqueIdDto, AckUserIdDto, SendUniqueIdDto, } from './message.dto'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'

@Injectable()
export class LastMessageService {
  private readonly logger = new Logger(LastMessageService.name, { timestamp: true })

  constructor(
    @InjectRepository(UserIdMessage)
    private readonly tUserId: Repository<UserIdMessage>,
    @InjectRepository(UniqueIdMessage)
    private readonly tUniqueId: Repository<UniqueIdMessage>,
  ) { }

  private parseContent(content: string) {
    try {
      return JSON.parse(content)
    } catch {
      return content
    }
  }

  private stringifyContent(data: any) {
    return typeof data === 'string' ? data : JSON.stringify(data)
  }

  private parseDate(value: Date | string | null | undefined) {
    if (!value) {
      return null
    }

    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
  }

  private getEnvelopeDates(entity: UserIdMessage | UniqueIdMessage) {
    const updatedAt = this.parseDate(entity.updatedAt)
    const expiresAt = this.parseDate(entity.expiresAt)

    if (!updatedAt || !expiresAt) {
      return null
    }

    return { updatedAt, expiresAt }
  }

  private toEnvelope(
    entity: UserIdMessage | UniqueIdMessage,
    dates: { updatedAt: Date; expiresAt: Date }
  ): TargetedMessageEnvelope {
    return {
      messageId: entity.messageId,
      data: this.parseContent(entity.content),
      updatedAt: dates.updatedAt.toISOString(),
      expiresAt: dates.expiresAt.toISOString(),
      ackRequired: true
    }
  }

  private isExpired(expiresAt: Date | string | null | undefined) {
    const date = this.parseDate(expiresAt)
    return !date || date.getTime() <= Date.now()
  }

  async queryUserId(body: Pick<SendUserIdDto, 'userId'>) {
    const entity = await this.tUserId.findOneBy({
      userId: body.userId
    })
    if (!entity) {
      this.logger.debug(`queryUserId miss userId=${body.userId}`)
      return null
    }
    const dates = this.getEnvelopeDates(entity)
    if (!dates || this.isExpired(dates.expiresAt)) {
      this.logger.warn(`queryUserId expired userId=${body.userId} messageId=${entity.messageId}`)
      await this.tUserId.delete({ userId: body.userId })
      return null
    }

    this.logger.debug(`queryUserId hit userId=${body.userId} messageId=${entity.messageId}`)
    return this.toEnvelope(entity, dates)
  }

  async createUserId(body: SendUserIdDto, ttlMs: number) {
    const now = new Date()
    const messageId = randomUUID()
    const expiresAt = new Date(now.getTime() + ttlMs)
    await this.tUserId.upsert({
      userId: body.userId,
      content: this.stringifyContent(body.data),
      messageId,
      updatedAt: now,
      expiresAt
    }, ['userId'])

    this.logger.log(`createUserId persisted userId=${body.userId} messageId=${messageId} expiresAt=${expiresAt.toISOString()}`)

    return {
      messageId,
      data: body.data,
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ackRequired: true
    } satisfies TargetedMessageEnvelope
  }

  async ackUserId(body: AckUserIdDto) {
    const result = await this.tUserId.delete({
      userId: body.userId,
      messageId: body.messageId
    })

    this.logger.log(`ackUserId userId=${body.userId} messageId=${body.messageId} affected=${result.affected ?? 0}`)
    return Boolean(result.affected)
  }

  async queryUniqueId(body: Pick<SendUniqueIdDto, 'uniqueId'>) {
    const entity = await this.tUniqueId.findOneBy({
      uniqueId: body.uniqueId
    })
    if (!entity) {
      this.logger.debug(`queryUniqueId miss uniqueId=${body.uniqueId}`)
      return null
    }
    const dates = this.getEnvelopeDates(entity)
    if (!dates || this.isExpired(dates.expiresAt)) {
      this.logger.warn(`queryUniqueId expired uniqueId=${body.uniqueId} messageId=${entity.messageId}`)
      await this.tUniqueId.delete({ uniqueId: body.uniqueId })
      return null
    }

    this.logger.debug(`queryUniqueId hit uniqueId=${body.uniqueId} messageId=${entity.messageId}`)
    return this.toEnvelope(entity, dates)
  }

  async createUniqueId(body: SendUniqueIdDto, ttlMs: number) {
    const now = new Date()
    const messageId = randomUUID()
    const expiresAt = new Date(now.getTime() + ttlMs)
    await this.tUniqueId.upsert({
      uniqueId: body.uniqueId,
      content: this.stringifyContent(body.data),
      messageId,
      updatedAt: now,
      expiresAt
    }, ['uniqueId'])

    this.logger.log(`createUniqueId persisted uniqueId=${body.uniqueId} messageId=${messageId} expiresAt=${expiresAt.toISOString()}`)

    return {
      messageId,
      data: body.data,
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ackRequired: true
    } satisfies TargetedMessageEnvelope
  }

  async ackUniqueId(body: AckUniqueIdDto) {
    const result = await this.tUniqueId.delete({
      uniqueId: body.uniqueId,
      messageId: body.messageId
    })

    this.logger.log(`ackUniqueId uniqueId=${body.uniqueId} messageId=${body.messageId} affected=${result.affected ?? 0}`)
    return Boolean(result.affected)
  }
}
