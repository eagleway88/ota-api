import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm'
import { CreateDateColumn, UpdateDateColumn } from 'typeorm'

/** 管理员表 */
@Entity('admins')
export class Admin {
  @PrimaryGeneratedColumn({
    type: 'int',
    name: 'id'
  })
  id: number

  /** 用户名 */
  @Column('varchar', {
    name: 'username',
    comment: '用户名',
    length: 255
  })
  username: string

  /** 密码 */
  @Column('varchar', {
    name: 'password',
    comment: '密码',
    length: 255
  })
  password: string

  /** 更新时间 */
  @UpdateDateColumn({
    name: 'update_time',
    comment: '更新时间'
  })
  updateTime: Date

  /** 创建时间 */
  @CreateDateColumn({
    name: 'create_time',
    comment: '创建时间'
  })
  createTime: Date
}
