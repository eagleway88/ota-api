import {
  ArgumentMetadata,
  INestApplication,
  ValidationPipe,
  VersioningType
} from '@nestjs/common'
import { LegacyUpdateCheckDto } from '@/compat/legacy/update-check.dto'
import { ExceptionFilter } from '@/middleware/exception-filter'
import { requestIdMiddleware } from '@/middleware/request-context'

class ApiValidationPipe extends ValidationPipe {
  private readonly legacy = new ValidationPipe()

  constructor() {
    super({ transform: true, whitelist: true, forbidNonWhitelisted: true })
  }

  override transform(value: unknown, metadata: ArgumentMetadata) {
    return metadata.metatype === LegacyUpdateCheckDto
      ? this.legacy.transform(value, metadata)
      : super.transform(value, metadata)
  }
}

/** Shared by production and HTTP contract tests. */
export function configureHttp(app: INestApplication) {
  app.setGlobalPrefix('api')
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' })
  app.use(requestIdMiddleware)
  app.useGlobalPipes(new ApiValidationPipe())
  app.useGlobalFilters(new ExceptionFilter())
}
