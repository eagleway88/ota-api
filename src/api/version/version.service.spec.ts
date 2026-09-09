import { ConfigService } from '@nestjs/config'
import { DataSource, QueryRunner } from 'typeorm'
import { createErrorTable, createSuccessTable } from '@/utils/version'
import { createVersionTable } from '@/utils/version'
import { VersionService } from './version.service'
import type { Request } from 'express'

function createQueryBuilder(result: Record<string, any>[]) {
  const builder = {
    select: jest.fn(),
    addSelect: jest.fn(),
    from: jest.fn(),
    andWhere: jest.fn(),
    groupBy: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue({ total: String(result.length) }),
    getRawMany: jest.fn().mockResolvedValue(result)
  }

  for (const method of [
    'select',
    'addSelect',
    'from',
    'andWhere',
    'groupBy',
    'orderBy',
    'addOrderBy',
    'skip',
    'take'
  ] as const) {
    builder[method].mockReturnValue(builder)
  }

  return builder
}

describe('VersionService.list', () => {
  it('returns versions with filters and success/error totals', async () => {
    const versionBuilder = createQueryBuilder([
      {
        id: 1000,
        name: 'desktop-app',
        ver: 100,
        platform: 'windows,linux',
        create_time: '2026-09-08T10:00:00.000Z'
      }
    ])
    const successBuilder = createQueryBuilder([{ verId: 1000, count: '3' }])
    const errorBuilder = createQueryBuilder([{ verId: 1000, count: '2' }])
    const manager = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValueOnce(versionBuilder)
        .mockReturnValueOnce(successBuilder)
        .mockReturnValueOnce(errorBuilder)
    }
    const queryRunner = {
      connect: jest.fn(),
      release: jest.fn(),
      getTables: jest
        .fn()
        .mockResolvedValue([
          createVersionTable('desktop-app'),
          createSuccessTable('desktop-app'),
          createErrorTable('desktop-app')
        ]),
      manager
    } as unknown as QueryRunner
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner)
    } as unknown as DataSource
    const configService = {
      get: jest.fn()
    } as unknown as ConfigService
    const service = new VersionService(
      {} as never,
      {} as never,
      configService,
      dataSource
    )

    await expect(
      service.list({ headers: {}, ip: '127.0.0.1' } as Request, 'desktop-app', {
        page: 2,
        pageSize: 10,
        ver: '1.0.0',
        platform: 'windows',
        enable: '1'
      })
    ).resolves.toEqual({
      code: 0,
      data: {
        data: [
          {
            id: 1000,
            name: 'desktop-app',
            ver: 100,
            platform: 'windows,linux',
            createTime: '2026-09-08T10:00:00.000Z',
            successCount: 3,
            errorCount: 2
          }
        ],
        total: 1
      }
    })

    expect(versionBuilder.andWhere).toHaveBeenCalledWith(
      'version.name = :name',
      { name: 'desktop-app' }
    )
    expect(versionBuilder.skip).toHaveBeenCalledWith(10)
    expect(versionBuilder.take).toHaveBeenCalledWith(10)
    expect(versionBuilder.andWhere).toHaveBeenCalledWith('version.ver = :ver', {
      ver: 100
    })
    expect(versionBuilder.andWhere).toHaveBeenCalledWith(
      'version.enable = :enable',
      { enable: 1 }
    )
    expect(versionBuilder.select).toHaveBeenNthCalledWith(
      1,
      'COUNT(*)',
      'total'
    )
    expect(versionBuilder.select).toHaveBeenNthCalledWith(2, 'version.*')
    expect(queryRunner.release).toHaveBeenCalled()
  })
})
