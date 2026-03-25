import * as dotenv from 'dotenv'
import { DataSource } from 'typeorm'
import { Logger } from '@nestjs/common'
import { join } from 'path'

const log = new Logger('Nest', { timestamp: true })

dotenv.config({ path: '.env' })

log.log(`>> ORM_HOST=${process.env.ORM_HOST}`)
log.log(`>> ORM_PORT=${process.env.ORM_PORT}`)
log.log(`>> ORM_USERNAME=${process.env.ORM_USERNAME}`)
log.log(`>> ORM_PASSWORD=${process.env.ORM_PASSWORD}`)
log.log(`>> ORM_DATABASE=${process.env.ORM_DATABASE}`)

export default new DataSource({
  type: 'mysql',
  host: process.env.ORM_HOST,
  port: Number(process.env.ORM_PORT),
  username: process.env.ORM_USERNAME,
  password: process.env.ORM_PASSWORD,
  database: process.env.ORM_DATABASE,
  entities: [join(__dirname, './entities', '*.{ts,js}')],
  migrations: [join(__dirname, './migrations', '*.{ts,js}')],
  synchronize: false
})
