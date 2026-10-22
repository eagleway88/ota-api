import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { AdminController } from '@/manage/auth/auth.controller'
import { AuthModule } from '@/auth/auth.module'
import { Admin } from '@/entities/admin.entity'
import { AdminService } from '@/auth/administrator.service'
import { PasswordHasher } from '@/auth/password-hasher'

@Module({
  imports: [AuthModule, TypeOrmModule.forFeature([Admin])],
  controllers: [AdminController],
  providers: [AdminService, PasswordHasher]
})
export class AdminModule {}
