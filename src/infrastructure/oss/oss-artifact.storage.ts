import { ConfigService } from '@nestjs/config'
import AliOSS from 'ali-oss'
import { posix } from 'path'
import { Injectable } from '@nestjs/common'
import { to } from '@/utils'
import { randomUUID } from 'crypto'

@Injectable()
export class OssArtifactStorage {
  private readonly oss?: AliOSS
  constructor(private readonly config: ConfigService) {
    const bucket = config.get<string>('OSS_BUCKET'),
      accessKeyId = config.get<string>('OSS_ACCESS_KEY_ID'),
      accessKeySecret = config.get<string>('OSS_ACCESS_KEY_SECRET'),
      region = config.get<string>('OSS_REGION')
    if (bucket && accessKeyId && accessKeySecret && region)
      this.oss = new AliOSS({ bucket, accessKeyId, accessKeySecret, region })
  }
  async put(
    directory: string,
    file: Express.Multer.File
  ): Promise<{ err?: string; url?: string }> {
    if (!this.oss) return { err: 'OSS initialization failed' }
    const prefix = this.config.get<string>('OSS_KEY_PREFIX') ?? ''
    const publicBaseUrl = this.config.get<string>('OSS_PUBLIC_BASE_URL')
    const filename =
      randomUUID() + posix.extname(file.originalname).toLowerCase()
    const objectKey = posix
      .join(prefix, directory, filename)
      .replace(/^\/+/, '')
    const [error, result] = await to<AliOSS.PutObjectResult>(
      this.oss.put(objectKey, file.buffer, { timeout: 600000 })
    )
    if (error || !result || result.res.status < 200 || result.res.status >= 300)
      return { err: error?.message ?? 'Upload failed' }
    return {
      url: publicBaseUrl
        ? publicBaseUrl.replace(/\/+$/, '') + '/' + objectKey
        : result.url
    }
  }
}
