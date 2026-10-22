import { INestApplication } from '@nestjs/common'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppApiModule } from '@/app/index'
import { ManageApiModule } from '@/manage'
import { LegacyCompatibilityModule } from '@/compat/legacy'
import { AdministrationModule } from '@/manage/common/administration.module'

export function configureSwagger(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('OTA API')
    .setVersion('1')
    .addBearerAuth()
    .build()
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, config)
  )
  for (const [group, modules] of [
    ['app', [AppApiModule]],
    // Swagger's deepScanRoutes scans one import level only. Include read assembly explicitly.
    ['manage', [ManageApiModule, AdministrationModule]],
    ['legacy', [LegacyCompatibilityModule]]
  ] as const) {
    SwaggerModule.setup(
      `api/docs/${group}`,
      app,
      SwaggerModule.createDocument(app, config, {
        include: [...modules],
        deepScanRoutes: true
      })
    )
  }
}
