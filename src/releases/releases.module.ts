import { Module } from '@nestjs/common'
import { ApplicationsModule } from '@/applications/applications.module'
import { WsModule } from '@/ws'
import { ReleaseManagementController } from './release-management.controller'
import { ReleaseManagementService } from './release-management.service'

@Module({
  imports: [ApplicationsModule, WsModule],
  controllers: [ReleaseManagementController],
  providers: [ReleaseManagementService]
})
export class ReleasesModule {}
