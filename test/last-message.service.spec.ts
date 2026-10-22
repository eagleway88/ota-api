import { Repository } from 'typeorm'
import { LastMessageService } from '@/messaging/last-message.service'
import { UserIdMessage } from '@/entities/user-id.entity'
import { UniqueIdMessage } from '@/entities/unique-id.entity'

describe('LastMessageService', () => {
  it('only deletes the expired message that was actually read', async () => {
    const expired = {
      userId: 'app:windows:1',
      messageId: 'old-message',
      content: '{}',
      updatedAt: new Date(Date.now() - 20_000),
      expiresAt: new Date(Date.now() - 10_000)
    } as UserIdMessage
    const deleteMessage = jest.fn().mockResolvedValue({ affected: 0 })
    const userRepository = {
      findOneBy: jest.fn().mockResolvedValue(expired),
      delete: deleteMessage
    } as unknown as Repository<UserIdMessage>
    const service = new LastMessageService(
      userRepository,
      {} as Repository<UniqueIdMessage>
    )

    await expect(
      service.queryUserId({ userId: expired.userId })
    ).resolves.toBeNull()
    expect(deleteMessage).toHaveBeenCalledWith({
      userId: expired.userId,
      messageId: expired.messageId
    })
  })

  it('ACK deletes by both target and messageId', async () => {
    const deleteMessage = jest.fn().mockResolvedValue({ affected: 1 })
    const userRepository = {
      delete: deleteMessage
    } as unknown as Repository<UserIdMessage>
    const service = new LastMessageService(
      userRepository,
      {} as Repository<UniqueIdMessage>
    )

    await expect(
      service.ackUserId({ userId: 'app:windows:1', messageId: 'message-1' })
    ).resolves.toBe(true)
    expect(deleteMessage).toHaveBeenCalledWith({
      userId: 'app:windows:1',
      messageId: 'message-1'
    })
  })
})
