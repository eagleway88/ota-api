import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('user_id_message')
export class UserIdMessage {
  @PrimaryGeneratedColumn({
    type: 'int',
    name: 'id'
  })
  id: number

  @Index('uq_user_id_message_user_id', { unique: true })
  @Column('varchar', {
    name: 'user_id',
    comment: 'userId',
    length: 255
  })
  userId: string

  @Column('text', {
    name: 'content',
    comment: 'content',
  })
  content: string

  @Column('varchar', {
    name: 'message_id',
    comment: 'messageId',
    length: 36
  })
  messageId: string

  @Column('datetime', {
    name: 'updated_at',
    comment: 'updatedAt',
    precision: 6,
    default: () => 'CURRENT_TIMESTAMP(6)',
    onUpdate: 'CURRENT_TIMESTAMP(6)'
  })
  updatedAt: Date

  @Index('idx_user_id_message_expires_at')
  @Column('datetime', {
    name: 'expires_at',
    comment: 'expiresAt',
    precision: 6
  })
  expiresAt: Date
}
