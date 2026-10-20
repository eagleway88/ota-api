import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { join } from 'path'

import { ReleasesModule } from './releases/releases.module'
import { validateRuntimeConfig } from './infrastructure/config/validate-config'
import { LegacyCompatibilityModule } from './compat/legacy/legacy.module'
import { AuthModule } from './auth/auth.module'
import { AdministrationModule } from './admin/administration.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
      validate: validateRuntimeConfig
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql',
        host: configService.get('ORM_HOST'),
        port: configService.get<number>('ORM_PORT'),
        username: configService.get('ORM_USERNAME'),
        password: configService.get('ORM_PASSWORD'),
        database: configService.get('ORM_DATABASE'),
        entities: [join(__dirname, './entities', '*.{ts,js}')],
        synchronize: false
      }),
      inject: [ConfigService]
    }),
    AuthModule,
    AdministrationModule,
    LegacyCompatibilityModule,
    ReleasesModule
  ],
  controllers: []
})
export class AppModule {}
