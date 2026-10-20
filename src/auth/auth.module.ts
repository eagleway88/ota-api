import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { AuthService } from './auth.service'
import { AuthGuard } from '@/guards/auth.guard'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { JwtModule } from '@nestjs/jwt'
import { TypeOrmModule } from '@nestjs/typeorm'
import { Admin } from '@/entities/admin.entity'

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Admin]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        global: true,
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1y' }
      }),
      inject: [ConfigService]
    })
  ],
  providers: [
    AuthService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard
    }
  ],
  exports: [AuthService]
})
export class AuthModule {}
