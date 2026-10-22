import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { AppApiModule } from '@/app/index'
import { JobsModule } from '@/jobs'
import { PublishTaskWorkerService } from '@/jobs/publish/publish-task-worker.service'
import { ReleaseManagementController } from '@/manage/releases/releases.controller'
import { ReleasesModule } from '@/releases/releases.module'
import { ManageReleasesModule } from '@/manage/releases/releases.module'
import { ReleaseWriteRepository } from '@/releases/ports/release-write.repository'
import { SqlReleaseRepository } from '@/infrastructure/persistence/sql-release.repository'
import { UpdateCheckController } from '@/app/updates/update-check.controller'
import { ApplicationRegistryService } from '@/applications/application-registry.service'

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
  it('registers only the publish worker, without a record-retention cleanup job', () => {
    expect(Reflect.getMetadata('providers', JobsModule)).toEqual([
      PublishTaskWorkerService
    ])
  })

  it('can replace the publication write port without loading App HTTP routes', async () => {
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
        get: () => undefined
      })
      .overrideProvider(ReleaseWriteRepository)
      .useValue(repository)
      .compile()
    try {
      jest
        .spyOn(module.get(ApplicationRegistryService), 'listReady')
        .mockResolvedValue([])
      await module.init()
      expect(module.get(ReleaseWriteRepository)).toBe(repository)
      expect(() => module.get(ReleaseManagementController)).toThrow()
      expect(() => module.get(UpdateCheckController)).toThrow()
    } finally {
      await module.close()
    }
  })
  it('assembles app and manage endpoints with one active task worker', async () => {
    const module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          ignoreEnvVars: true
        }),
        TestPersistenceModule,
        AppApiModule,
        ManageReleasesModule
      ]
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: () => undefined
      })
      .compile()

    try {
      jest
        .spyOn(module.get(ApplicationRegistryService), 'listReady')
        .mockResolvedValue([])
      await module.init()
      expect(module.get(ReleaseManagementController)).toBeDefined()
      expect(module.get(ReleaseWriteRepository)).toBe(
        module.get(SqlReleaseRepository)
      )
      expect(
        module
          .select(JobsModule)
          .get(PublishTaskWorkerService, { strict: true })
      ).toBe(module.get(PublishTaskWorkerService))
      expect(database.createQueryRunner).not.toHaveBeenCalled()
    } finally {
      await module.close()
    }
  })
})
