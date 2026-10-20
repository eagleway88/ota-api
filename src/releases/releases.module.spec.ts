import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { LegacyCompatibilityModule } from '@/compat/legacy/legacy.module'
import { PublishTasksModule } from '@/infrastructure/tasks/publish-tasks.module'
import { PublishTaskWorkerService } from '@/infrastructure/tasks/publish-task-worker.service'
import { ReleaseManagementController } from './release-management.controller'
import { ReleasesModule } from './releases.module'
import { ReleaseWriteRepository } from './ports/release-write.repository'
import { DualWriteReleaseRepository } from '@/compat/legacy/persistence/dual-write-release.repository'
import { VersionController } from '@/compat/legacy/http/version/version.controller'

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
class TestPersistenceModule {}

describe('release module wiring', () => {
  it('can replace the publication write port without loading legacy HTTP routes', async () => {
    const repository = { insert: jest.fn(), setEnabled: jest.fn() }
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        TestPersistenceModule,
        ReleasesModule
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === 'PUBLISH_TASKS_PAUSED' ? 'true' : undefined
      })
      .overrideProvider(ReleaseWriteRepository)
      .useValue(repository)
      .compile()
    try {
      await module.init()
      expect(module.get(ReleaseWriteRepository)).toBe(repository)
      expect(module.get(ReleaseManagementController)).toBeDefined()
      expect(() => module.get(VersionController)).toThrow()
    } finally {
      await module.close()
    }
  })
  it('assembles legacy and v2 endpoints with one paused task worker', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        TestPersistenceModule,
        LegacyCompatibilityModule,
        ReleasesModule
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: (key: string) =>
          key === 'PUBLISH_TASKS_PAUSED' ? 'true' : undefined
      })
      .compile()

    try {
      await module.init()
      expect(module.get(ReleaseManagementController)).toBeDefined()
      expect(module.get(ReleaseWriteRepository)).toBe(
        module.get(DualWriteReleaseRepository)
      )
      expect(
        module
          .select(PublishTasksModule)
          .get(PublishTaskWorkerService, { strict: true })
      ).toBe(module.get(PublishTaskWorkerService))
      expect(database.createQueryRunner).not.toHaveBeenCalled()
    } finally {
      await module.close()
    }
  })
})
