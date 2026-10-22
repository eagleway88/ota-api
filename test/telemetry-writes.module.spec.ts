import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'
import { DataSource } from 'typeorm'
import { UpdateCheckController } from '@/app/updates/update-check.controller'
import { TelemetryWriteRepository } from '@/telemetry/ports/telemetry-write.repository'
import { TelemetryWriteService } from '@/telemetry/telemetry-write.service'
import { TelemetryWritesModule } from '@/telemetry/telemetry-writes.module'

const database = { createQueryRunner: jest.fn() }
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: database }],
  exports: [DataSource]
})
class PersistenceFixture {}

describe('telemetry write boundary', () => {
  it('replaces persistence without loading HTTP controllers, workers or OSS', async () => {
    const reports = {
      success: jest.fn().mockResolvedValue({ id: 1 }),
      failure: jest.fn(),
      applicationError: jest.fn()
    }
    const module = await Test.createTestingModule({
      imports: [PersistenceFixture, TelemetryWritesModule]
    })
      .overrideProvider(TelemetryWriteRepository)
      .useValue(reports)
      .compile()
    try {
      await module.init()
      const input = {
        appName: 'app',
        platform: 'windows',
        versionCode: 100,
        releaseSequence: 2000
      }
      expect(await module.get(TelemetryWriteService).success(input)).toEqual({
        id: 1
      })
      expect(reports.success).toHaveBeenCalledWith(input, expect.any(Object))
      expect(() => module.get(UpdateCheckController)).toThrow()
      expect(database.createQueryRunner).not.toHaveBeenCalled()
    } finally {
      await module.close()
    }
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER])(
    'rejects invalid release association %s before persistence',
    value => {
      const reports = { success: jest.fn() }
      const service = new TelemetryWriteService(
        reports as unknown as TelemetryWriteRepository
      )
      expect(() =>
        service.success({
          appName: 'app',
          platform: 'windows',
          versionCode: 100,
          releaseSequence: value
        })
      ).toThrow('Invalid report or release ID')
      expect(reports.success).not.toHaveBeenCalled()
    }
  )
})
