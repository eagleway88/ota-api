import {
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common'
import { ExceptionFilter } from '@/middleware/exception-filter'
import { requestIdMiddleware } from '@/middleware/request-context'

/** Shared by production and HTTP contract tests. */
export function configureHttp(app: INestApplication) {
  app.setGlobalPrefix('api')
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.use(requestIdMiddleware)
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true
    })
  )
  app.useGlobalFilters(new ExceptionFilter())
}
