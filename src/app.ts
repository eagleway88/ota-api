import { Logger, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { TypeOrmModule } from '@nestjs/typeorm'
import { join } from 'path'

import { AdminModule } from './api/admin/admin.module'
import { VersionModule } from './api/version/version.module'
import { MessageModule } from './api/message/message.module'

const log = new Logger('TypeOrmConfig', { timestamp: true })

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env']
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => {
        const host = configService.get('ORM_HOST')
        const port = configService.get('ORM_PORT')
        const database = configService.get('ORM_DATABASE')

        log.log(`runtime orm host=${host} port=${port} database=${database}`)

        return {
          type: 'mysql',
          host,
          port,
          username: configService.get('ORM_USERNAME'),
          password: configService.get('ORM_PASSWORD'),
          database,
          entities: [join(__dirname, './entities', '*.{ts,js}')],
          synchronize: false
        }
      },
      inject: [ConfigService]
    }),
    AdminModule,
    MessageModule,
    VersionModule
  ],
  controllers: []
})
export class AppModule { }
