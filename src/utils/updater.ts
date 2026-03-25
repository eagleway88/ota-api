import { ConfigService } from '@nestjs/config'
import AliOSS from 'ali-oss'
import { join } from 'path'
import { to } from '.'
import { createHash } from 'crypto'

export class UpdaterUtil {
  private oss?: AliOSS
  constructor(private readonly configService: ConfigService) {
    const opts = this.fetchOSSOptions()
    if (opts) this.oss = new AliOSS(opts)
  }

  private fetchOSSOptions(): AliOSS.Options | undefined {
    const bucket = this.configService.get<string>('OSS_BUCKER')
    const accessKeyId = this.configService.get<string>('OSS_KEY')
    const accessKeySecret = this.configService.get<string>('OSS_SECRET')
    const region = this.configService.get<string>('OSS_REGION')
    if (bucket && accessKeyId && accessKeySecret && region) {
      return { bucket, accessKeyId, accessKeySecret, region }
    }
  }

  async put(
    dir: string,
    file: Express.Multer.File
  ): Promise<{ err?: string; url?: string }> {
    if (!this.oss) {
      return { err: 'OSS initialization failed' }
    }
    const suffix = file.originalname.split('.').pop()
    const filrName = `${createHash('md5').update(`${Date.now()}`).digest('hex')}.${suffix}`
    const ossDir = this.configService.get('OSS_DIR') || ''
    const ossUrl = this.configService.get('OSS_URL') || ''
    const ossPath = join(ossDir, dir, filrName)
    const [err, res] = await to(
      this.oss.put(ossPath, file.buffer, { timeout: 600000 })
    )
    if (err || res?.res.status !== 200) {
      let msg = err?.message
      if (!msg && res) msg = JSON.stringify(res)
      return { err: msg }
    }
    return { url: `${ossUrl}/${ossPath}` }
  }
}
