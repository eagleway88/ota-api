import { ConflictException, Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { DataSource, QueryRunner } from 'typeorm'
import {
  ApplicationRegistryService,
  RegisteredApplication
} from '@/applications/application-registry.service'

@Injectable()
export class AdminReadRepository {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly applications: ApplicationRegistryService
  ) {}

  async withApplication<T>(
    appName: string,
    read: (
      runner: QueryRunner,
      application: RegisteredApplication
    ) => Promise<T>
  ) {
    const application = await this.applications.resolve(appName)
    if (application.status !== 'ready') {
      throw new ConflictException(
        'Application must be registered and prepared before querying administration data'
      )
    }
    return this.withConnection(runner => read(runner, application))
  }

  async withConnection<T>(read: (runner: QueryRunner) => Promise<T>) {
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    try {
      return await read(runner)
    } finally {
      await runner.release()
    }
  }

  async requireTable(runner: QueryRunner, tableName: string) {
    const table = await runner.getTable(tableName)
    if (!table) {
      throw new ConflictException(
        'Administration schema is not ready; complete the application/global migration first'
      )
    }
    return table
  }
}
