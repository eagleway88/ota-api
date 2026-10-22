import { Module } from '@nestjs/common'
import { AdministrationModule } from './common/administration.module'
import { MessageModule } from './messages/messages.module'
import { ManageReleasesModule } from './releases/releases.module'
import { ManageArtifactsModule } from './artifacts/artifacts.module'
import { ReleasesModule } from '@/releases/releases.module'

@Module({
  imports: [
    AdministrationModule,
    MessageModule,
    ManageReleasesModule,
    ManageArtifactsModule,
    ReleasesModule
  ]
})
export class ManageApiModule {}
