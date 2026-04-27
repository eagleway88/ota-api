import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

@Entity('unique_id_message')
export class UniqueIdMessage {
  @PrimaryGeneratedColumn({
    type: 'int',
    name: 'id'
  })
  id: number

  // 唯一索引的 ID 字段不该用 255 的 utf8mb4 varchar；把它们收窄到 191，
  // 就能让 MySQL 5.6/旧 InnoDB 正常建唯一索引
  @Index('uq_unique_id_message_unique_id', { unique: true })
  @Column('varchar', {
    name: 'unique_id',
    comment: 'uniqueId',
    length: 191
  })
  uniqueId: string

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

  @Index('idx_unique_id_message_expires_at')
  @Column('datetime', {
    name: 'expires_at',
    comment: 'expiresAt',
    precision: 6
  })
  expiresAt: Date
}
