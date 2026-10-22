import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

@Entity('ota_messages')
export class ApplicationMessage {
  @PrimaryColumn('varchar', {
    name: 'app_name',
    length: 128,
    collation: 'utf8mb4_bin'
  })
  appName: string

  @PrimaryColumn('varchar', { name: 'target_type', length: 8 })
  targetType: 'user' | 'device'

  @PrimaryColumn('varchar', {
    name: 'target_id',
    length: 191,
    collation: 'utf8mb4_bin'
  })
  targetId: string

  @Column('text')
  content: string

  @Column('varchar', { name: 'message_id', length: 36 })
  messageId: string

  @Column('datetime', { name: 'updated_at', precision: 6 })
  updatedAt: Date

  @Index('ota_messages_expiry_idx')
  @Column('datetime', { name: 'expires_at', precision: 6 })
  expiresAt: Date
}
