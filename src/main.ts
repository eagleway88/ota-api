import { AppModule } from './app'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe } from '@nestjs/common'
import { ExceptionFilter } from './middleware/exception.filter'
import { TransformInterceptor } from './middleware/transform.interceptor'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { ConfigService } from '@nestjs/config'
import compression from 'compression'
import { urlencoded, json } from 'express'
import helmet from 'helmet'

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true
  })

  const configService = app.get(ConfigService)
  app.useGlobalPipes(new ValidationPipe())
  app.useGlobalFilters(new ExceptionFilter())
  app.useGlobalInterceptors(new TransformInterceptor())

  app.use(urlencoded({ extended: true, limit: '50mb' }))
  app.use(json({ limit: '50mb' }))
  app.setGlobalPrefix('api')
  app.set('trust proxy', 1)
  app.use(compression())
  app.use(helmet())

  const builder = new DocumentBuilder()
  // 文档接口鉴权
  builder.addBearerAuth()
  const document = SwaggerModule.createDocument(app, builder.build())
  SwaggerModule.setup('api/docs', app, document)

  await app.listen(configService.get('PORT') || 3001)
}

bootstrap()
