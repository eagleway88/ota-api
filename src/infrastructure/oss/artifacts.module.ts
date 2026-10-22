import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { ApplicationsModule } from '@/applications/applications.module'
import { ArtifactService } from '@/infrastructure/oss/artifact.service'
import { OssArtifactStorage } from '@/infrastructure/oss/oss-artifact.storage'

@Module({
  imports: [ConfigModule, ApplicationsModule],
  providers: [ArtifactService, OssArtifactStorage],
  exports: [ArtifactService, OssArtifactStorage]
})
export class ArtifactsModule {}
