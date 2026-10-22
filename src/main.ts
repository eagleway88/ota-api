import { AppModule } from './app'
import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'
import { ConfigService } from '@nestjs/config'
import { configureHttp } from '@/config/http'
import { configureSwagger } from '@/config/swagger'
import compression from 'compression'
import { urlencoded, json } from 'express'
import helmet from 'helmet'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true
  })
  const config = app.get(ConfigService)
  configureHttp(app)
  app.use(urlencoded({ extended: true, limit: '50mb' }))
  app.use(json({ limit: '50mb' }))
  const trustProxyHops = config.get<number>('TRUST_PROXY_HOPS') ?? 1
  app.set('trust proxy', trustProxyHops > 0 ? trustProxyHops : false)
  app.use(compression())
  app.use(helmet())
  configureSwagger(app)
  await app.listen(config.get('PORT') || 3001)
}

void bootstrap()
