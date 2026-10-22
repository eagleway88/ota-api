import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { SwaggerModule, OpenAPIObject } from '@nestjs/swagger'
import { DataSource } from 'typeorm'
import { AppApiModule } from '@/app/index'
import { ManageApiModule } from '@/manage'
import { configureHttp } from '@/config/http'
import { configureSwagger } from '@/config/swagger'

const database = {
  options: { type: 'mysql' },
  entityMetadatas: [],
  getRepository: () => ({}),
  createQueryRunner: jest.fn()
}
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: database }],
  exports: [DataSource]
})
class PersistenceFixture {}

describe('App/Manage API assembly and documentation', () => {
  it('includes every registered API in exactly one public/manage document', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        PersistenceFixture,
        AppApiModule,
        ManageApiModule
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: () => undefined
      })
      .compile()
    const app = module.createNestApplication({ logger: false })
    const documents = new Map<string, OpenAPIObject>()
    const setup = jest
      .spyOn(SwaggerModule, 'setup')
      .mockImplementation((path, _app, document) => {
        documents.set(
          path,
          typeof document === 'function' ? document() : document
        )
      })
    try {
      configureHttp(app)
      configureSwagger(app)
      const paths = (group: string) =>
        Object.keys(documents.get('api/docs' + group)!.paths).sort()
      const manage = paths('/manage'),
        client = paths('/app')
      expect(manage.length).toBeGreaterThan(15)
      expect(manage.every(path => path.startsWith('/api/v1/manage/'))).toBe(
        true
      )
      expect(client.every(path => path.startsWith('/api/v1/app/'))).toBe(true)
      expect(client).toContain('/api/v1/app/apps/{appName}/updates/check')
      expect(documents.has('api/docs/legacy')).toBe(false)
      for (const path of [
        '/api/v1/manage/apps/{appName}/audit-logs',
        '/api/v1/manage/apps/{appName}/statistics/summary',
        '/api/v1/manage/apps/{appName}/tasks/{taskId}/logs',
        '/api/v1/manage/apps/{appName}/messages/devices',
        '/api/v1/manage/apps/{appName}/artifacts',
        '/api/v1/manage/apps/{appName}/releases'
      ]) {
        expect(manage).toContain(path)
      }
      expect(paths('')).toEqual([...manage, ...client].sort())
      expect(
        paths('').some(path => /\/v2\/|\/admin\/|\/message\//.test(path))
      ).toBe(false)
      expect(manage.some(path => /auth|prepare|keys/.test(path))).toBe(false)
      expect(database.createQueryRunner).not.toHaveBeenCalled()
    } finally {
      setup.mockRestore()
      await app.close()
    }
  })
})
