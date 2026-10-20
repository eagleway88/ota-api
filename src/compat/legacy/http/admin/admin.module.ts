import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AdminController } from './admin.controller'
import { AuthModule } from '@/auth/auth.module'
import { Admin } from '@/entities/admin.entity'
import { AdminService } from './admin.service'
import { PasswordHasher } from '@/admin/password-hasher'

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Admin])],
  controllers: [AdminController],
  providers: [AdminService, PasswordHasher]
})
export class AdminModule {}
