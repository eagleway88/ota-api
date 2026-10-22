import { BadRequestException, Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'crypto'
import {
  UserMessageCommand,
  DeviceMessageCommand,
  UserMessageAck,
  DeviceMessageAck,
  TargetedMessageEnvelope
} from '@/contracts/messaging'
import { parseUserId } from '@/contracts/user-id'
import { ApplicationMessage } from '@/entities/application-message.entity'

type MessageTarget = Pick<
  ApplicationMessage,
  'appName' | 'targetType' | 'targetId'
>

@Injectable()
export class LastMessageService {
  constructor(
    @InjectRepository(ApplicationMessage)
    private readonly messages: Repository<ApplicationMessage>
  ) {}

  private userTarget(userId: string): MessageTarget {
    const parsed = parseUserId(userId)
    if (!parsed) throw new BadRequestException('Invalid userId')
    return { appName: parsed.appName, targetType: 'user', targetId: userId }
  }

  private deviceTarget(
    body: Pick<DeviceMessageCommand, 'appName' | 'uniqueId'>
  ): MessageTarget {
    return {
      appName: body.appName,
      targetType: 'device',
      targetId: body.uniqueId
    }
  }

  private async query(
    target: MessageTarget
  ): Promise<TargetedMessageEnvelope | null> {
    const entity = await this.messages.findOneBy(target)
    if (!entity) return null
    const updatedAt = new Date(entity.updatedAt)
    const expiresAt = new Date(entity.expiresAt)
    if (
      !Number.isFinite(updatedAt.getTime()) ||
      !Number.isFinite(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      // A concurrent replacement must not be deleted with the expired message.
      await this.messages.delete({ ...target, messageId: entity.messageId })
      return null
    }
    return {
      messageId: entity.messageId,
      data: JSON.parse(entity.content) as unknown,
      updatedAt: updatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ackRequired: true
    }
  }

  private async create(
    target: MessageTarget,
    data: unknown,
    ttlMs: number
  ): Promise<
    TargetedMessageEnvelope & { messageId: string; expiresAt: string }
  > {
    const updatedAt = new Date()
    const expiresAt = new Date(updatedAt.getTime() + ttlMs)
    const messageId = randomUUID()
    const normalizedData = data === undefined ? null : data
    await this.messages.upsert(
      {
        ...target,
        content: JSON.stringify(normalizedData),
        messageId,
        updatedAt,
        expiresAt
      },
      ['appName', 'targetType', 'targetId']
    )
    return {
      messageId,
      data: normalizedData,
      updatedAt: updatedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ackRequired: true
    }
  }

  private async ack(target: MessageTarget, messageId: string) {
    const result = await this.messages.delete({ ...target, messageId })
    return Boolean(result.affected)
  }

  queryUserId(body: Pick<UserMessageCommand, 'userId'>) {
    return this.query(this.userTarget(body.userId))
  }
  createUserId(body: UserMessageCommand, ttlMs: number) {
    return this.create(this.userTarget(body.userId), body.data, ttlMs)
  }
  ackUserId(body: UserMessageAck) {
    return this.ack(this.userTarget(body.userId), body.messageId)
  }
  queryUniqueId(body: Pick<DeviceMessageCommand, 'appName' | 'uniqueId'>) {
    return this.query(this.deviceTarget(body))
  }
  createUniqueId(body: DeviceMessageCommand, ttlMs: number) {
    return this.create(this.deviceTarget(body), body.data, ttlMs)
  }
  ackUniqueId(body: DeviceMessageAck) {
    return this.ack(this.deviceTarget(body), body.messageId)
  }
}
