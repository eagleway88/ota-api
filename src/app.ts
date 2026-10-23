import { Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { join } from 'path'

import { validateRuntimeConfig } from '@/config/environment'
import { AuthModule } from './auth/auth.module'
import { AppApiModule } from '@/app/index'
import { ManageApiModule } from '@/manage'
import { JobsModule } from '@/jobs'

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
    AppApiModule,
    ManageApiModule,
    JobsModule
  ],
  controllers: []
})
export class AppModule {}
