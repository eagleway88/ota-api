import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'

@Entity('unique_id_message')
export class UniqueIdMessage {
  @PrimaryGeneratedColumn({
    type: 'int',
    name: 'id'
  })
  id: number

  @Column('varchar', {
    name: 'unique_id',
    comment: 'uniqueId',
    length: 255
  })
  uniqueId: string

  @Column('text', {
    name: 'content',
    comment: 'content',
  })
  content: string
}
