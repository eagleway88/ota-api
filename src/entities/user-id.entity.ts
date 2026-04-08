import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('user_id_message')
export class UserIdMessage {
  @PrimaryGeneratedColumn({
    type: 'int',
    name: 'id'
  })
  id: number

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
}
