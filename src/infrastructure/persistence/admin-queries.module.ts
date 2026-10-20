import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { AdminReadRepository } from './admin-read.repository'

@Module({
  imports: [ApplicationsModule],
  providers: [AdminReadRepository],
  exports: [AdminReadRepository]
})
export class AdminQueriesModule {}
