import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthService } from './auth.service'
import { AuthGuard } from '@/guards/auth.guard'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Admin } from '@/entities/admin.entity'
import { AdministratorService } from './administrator.service'
import { PasswordHasher } from './password-hasher'

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Admin]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET')
      }),
      inject: [ConfigService]
    })
  ],
  providers: [
    AuthService,
    AdministratorService,
    PasswordHasher,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ],
  exports: [AuthService, AdministratorService]
})
export class AuthModule {}
