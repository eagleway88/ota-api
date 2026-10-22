import { Repository } from 'typeorm'
import { LastMessageService } from '@/messaging/last-message.service'
import { ApplicationMessage } from '@/entities/application-message.entity'

describe('LastMessageService', () => {
  it('only deletes the expired message that was actually read', async () => {
    const expired = {
      appName: 'app',
      targetType: 'user',
      targetId: 'app:windows:1',
      messageId: 'old-message',
      content: '{}',
      updatedAt: new Date(Date.now() - 20_000),
      expiresAt: new Date(Date.now() - 10_000)
    } as ApplicationMessage
    const deleteMessage = jest.fn().mockResolvedValue({ affected: 0 })
    const service = new LastMessageService({
      findOneBy: jest.fn().mockResolvedValue(expired),
      delete: deleteMessage
    } as unknown as Repository<ApplicationMessage>)
    await expect(
      service.queryUserId({ userId: expired.targetId })
    ).resolves.toBeNull()
    expect(deleteMessage).toHaveBeenCalledWith({
      appName: 'app',
      targetType: 'user',
      targetId: expired.targetId,
      messageId: expired.messageId
    })
  })

  it('ACK deletes by application, target type, target ID and messageId', async () => {
    const deleteMessage = jest.fn().mockResolvedValue({ affected: 1 })
    const service = new LastMessageService({
      delete: deleteMessage
    } as unknown as Repository<ApplicationMessage>)
    await expect(
      service.ackUserId({ userId: 'app:windows:1', messageId: 'message-1' })
    ).resolves.toBe(true)
    expect(deleteMessage).toHaveBeenCalledWith({
      appName: 'app',
      targetType: 'user',
      targetId: 'app:windows:1',
      messageId: 'message-1'
    })
  })

  it('rejects malformed user targets before accessing persistence', () => {
    const find = jest.fn()
    const service = new LastMessageService({
      findOneBy: find
    } as unknown as Repository<ApplicationMessage>)
    expect(() => service.queryUserId({ userId: 'unscoped' })).toThrow(
      'Invalid userId'
    )
    expect(find).not.toHaveBeenCalled()
  })
})
