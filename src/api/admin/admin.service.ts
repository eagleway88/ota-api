import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { AdminDto } from './admin.dto'
import { apiUtil } from '@/utils/api'
import { Admin } from '@/entities/admin.entity'
import { AuthService } from '@/auth/auth.service'

@Injectable()
export class AdminService {
  constructor(
    private readonly authService: AuthService,
    @InjectRepository(Admin)
    private readonly admin: Repository<Admin>,
  ) { }

  async create(body: AdminDto) {
    const list = await this.admin.find()
    if (list.length) return apiUtil.error('Account already exists')
    const entity = new Admin()
    entity.username = body.username
    entity.password = body.password
    const res = await this.admin.save(entity)
    return apiUtil.data(res)
  }

  async login(body: AdminDto) {
    const user = await this.admin.findOneBy({
      username: body.username
    })
    if (!user) return apiUtil.error('Account does not exist')
    if (body.password !== user.password) {
      return apiUtil.error('Incorrect password')
    }
    const token = await this.authService.signAsync({
      sub: user.id,
      uid: user.id,
      username: user.username
    })
    return apiUtil.data(token)
  }
}
