import { Module } from '@nestjs/common'
import { ApplicationRegistryService } from './application-registry.service'
import { ApplicationTableResolver } from '@/infrastructure/persistence/application-table-resolver'

@Module({
  providers: [ApplicationRegistryService, ApplicationTableResolver],
  exports: [ApplicationRegistryService, ApplicationTableResolver]
})
export class ApplicationsModule {}
