import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AdminDto } from './admin.dto'
import { apiUtil } from '@/utils/api'
import { Admin } from '@/entities/admin.entity'
import { AuthService } from '@/auth/auth.service'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource } from 'typeorm'
import { PasswordHasher } from '@/admin/password-hasher'

@Injectable()
export class AdminService {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordHasher: PasswordHasher,
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Admin)
    private readonly admin: Repository<Admin>
  ) {}

  async create(body: AdminDto) {
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    let lockAcquired = false
    try {
      const lockRows = (await queryRunner.query(
        "SELECT GET_LOCK('ota_admin_initialization', 10) AS acquired"
      )) as Array<{ acquired: number | string }>
      lockAcquired = Number(lockRows[0]?.acquired) === 1
      if (!lockAcquired) {
        return apiUtil.error('Administrator initialization is busy')
      }
      const count = await queryRunner.manager.count(Admin)
      if (count) {
        return apiUtil.error('Account already exists')
      }
      const entity = queryRunner.manager.create(Admin, {
        username: body.username,
        password: await this.passwordHasher.hash(body.password)
      })
      const saved = await queryRunner.manager.save(entity)
      return apiUtil.data(this.publicAdmin(saved))
    } finally {
      if (lockAcquired) {
        await queryRunner.query(
          "SELECT RELEASE_LOCK('ota_admin_initialization')"
        )
      }
      await queryRunner.release()
    }
  }

  async login(body: AdminDto) {
    const user = await this.admin
      .createQueryBuilder('admin')
      .addSelect('admin.password')
      .where('admin.username = :username', { username: body.username })
      .getOne()
    if (!user) return apiUtil.error('Account does not exist')
    const verification = await this.passwordHasher.verify(
      body.password,
      user.password
    )
    if (!verification.valid) {
      return apiUtil.error('Incorrect password')
    }
    if (verification.needsRehash) {
      await this.admin.update(user.id, {
        password: await this.passwordHasher.hash(body.password)
      })
    }
    const token = await this.authService.signAsync({
      sub: user.id,
      uid: user.id,
      username: user.username
    })
    return apiUtil.data(token)
  }

  private publicAdmin(admin: Admin) {
    return {
      id: admin.id,
      username: admin.username,
      updateTime: admin.updateTime,
      createTime: admin.createTime
    }
  }
}
