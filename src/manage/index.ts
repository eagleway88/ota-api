import { Module } from '@nestjs/common'
import { AdministrationModule } from './common/administration.module'
import { ManageAuthModule } from './auth/auth.module'
import { MessageModule } from './messages/messages.module'
import { ManageReleasesModule } from './releases/releases.module'
import { ManageArtifactsModule } from './artifacts/artifacts.module'
import { ApplicationsController } from './applications/applications.controller'
import { ReleasesModule } from '@/releases/releases.module'

@Module({
  imports: [
    AdministrationModule,
    ManageAuthModule,
    MessageModule,
    ManageReleasesModule,
    ManageArtifactsModule,
    ReleasesModule
  ],
  controllers: [ApplicationsController]
})
export class ManageApiModule {}
