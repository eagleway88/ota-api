import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { InjectDataSource } from '@nestjs/typeorm'
import { createHash, randomUUID } from 'crypto'
import { DataSource } from 'typeorm'
import { ApplicationRegistryService } from '@/applications/application-registry.service'
import { ReleaseOperationContext } from '@/contracts/release-operation'
import { apiUtil } from '@/utils/api'
import { insertAudit } from '@/audit/global-audit'
import { OssArtifactStorage } from '@/infrastructure/oss/oss-artifact.storage'
import {
  otaUploadMaxBytes,
  validateOtaUpload
} from '@/infrastructure/oss/upload-policy'

@Injectable()
export class ArtifactService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
    private readonly applications: ApplicationRegistryService,
    private readonly storage: OssArtifactStorage
  ) {}

  async uploadArtifact(
    appName: string,
    file: Express.Multer.File | undefined,
    context: ReleaseOperationContext
  ) {
    if (!file) {
      return apiUtil.error('File is required')
    }
    const uploadError = validateOtaUpload(
      file,
      otaUploadMaxBytes(this.configService.get('OTA_UPLOAD_MAX_BYTES'))
    )
    if (uploadError) {
      return apiUtil.error(uploadError)
    }

    const application = await this.applications.requireReady(appName)
    const artifactId = randomUUID()
    const checksumSha256 = createHash('sha256')
      .update(file.buffer)
      .digest('hex')
    const uploaded = await this.storage.put(
      `${appName}/artifacts/${artifactId}`,
      file
    )
    if (!uploaded.url || uploaded.err) {
      return apiUtil.error(uploaded.err || 'Upload failed')
    }
    const storageKey = this.storageKey(uploaded.url)
    const queryRunner = this.dataSource.createQueryRunner()
    await queryRunner.connect()
    try {
      await queryRunner.startTransaction()
      const now = new Date()
      await queryRunner.manager
        .createQueryBuilder()
        .insert()
        .into(application.tables.artifact)
        .values({
          artifact_id: artifactId,
          storage_key: storageKey,
          url: uploaded.url,
          size_bytes: file.size,
          checksum_sha256: checksumSha256,
          status: 'pending',
          created_at: now,
          updated_at: now
        })
        .execute()
      await insertAudit(
        queryRunner,
        {
          context,
          action: 'artifact_uploaded',
          targetType: 'artifact',
          targetId: artifactId,
          result: 'succeeded',
          changeSummary: { sizeBytes: file.size, checksumSha256 }
        },
        application.tables.auditLog
      )
      await queryRunner.commitTransaction()
      return apiUtil.data({
        artifactId,
        url: uploaded.url,
        sizeBytes: file.size,
        checksumSha256,
        status: 'pending'
      })
    } catch (error) {
      if (queryRunner.isTransactionActive)
        await queryRunner.rollbackTransaction()
      throw error
    } finally {
      await queryRunner.release()
    }
  }

  private storageKey(url: string) {
    try {
      return new URL(url).pathname.replace(/^\//, '')
    } catch {
      return url
    }
  }
}
