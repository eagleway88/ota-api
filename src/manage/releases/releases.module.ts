import { Module } from '@nestjs/common'
import { ReleasesModule } from '@/releases/releases.module'
import { ReleaseManagementController } from './releases.controller'

@Module({
  imports: [ReleasesModule],
  controllers: [ReleaseManagementController]
})
export class ManageReleasesModule {}
