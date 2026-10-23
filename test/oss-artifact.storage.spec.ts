import AliOSS from 'ali-oss'
import { ConfigService } from '@nestjs/config'
import { OssArtifactStorage } from '@/infrastructure/oss/oss-artifact.storage'
jest.mock('ali-oss')
const put = jest.fn()
const config = {
  OSS_BUCKET: 'bucket',
  OSS_ACCESS_KEY_ID: 'key',
  OSS_ACCESS_KEY_SECRET: 'secret',
  OSS_REGION: 'region'
}
const file = {
  originalname: 'update.ZIP',
  buffer: Buffer.from('data')
} as Express.Multer.File
beforeEach(() => {
  jest.clearAllMocks()
  jest.mocked(AliOSS).mockImplementation(() => ({ put }) as unknown as AliOSS)
  put.mockResolvedValue({
    url: 'https://bucket.example.test/object.zip',
    res: { status: 200 }
  })
})
describe('OSS artifact storage', () => {
  it('uses explicit configuration and unique object keys', async () => {
    const storage = new OssArtifactStorage(
      new ConfigService({
        ...config,
        OSS_KEY_PREFIX: 'packages',
        OSS_PUBLIC_BASE_URL: 'https://cdn.example.test///'
      })
    )
    const a = await storage.put('app/artifacts', file),
      b = await storage.put('app/artifacts', file)
    expect(AliOSS).toHaveBeenCalledWith({
      bucket: 'bucket',
      accessKeyId: 'key',
      accessKeySecret: 'secret',
      region: 'region'
    })
    expect(a.url).toMatch(
      /^https:\/\/cdn\.example\.test\/packages\/app\/artifacts\/[a-f0-9-]{36}\.zip$/
    )
    expect(b.url).not.toBe(a.url)
    expect(put).toHaveBeenCalledTimes(2)
  })
  it('uses the storage-provided URL when no public base URL is configured', async () => {
    expect(
      await new OssArtifactStorage(new ConfigService(config)).put(
        'app/artifacts',
        file
      )
    ).toEqual({ url: 'https://bucket.example.test/object.zip' })
  })
  it('returns upload errors without publishing a URL', async () => {
    put.mockRejectedValueOnce(new Error('storage unavailable'))
    expect(
      await new OssArtifactStorage(new ConfigService(config)).put(
        'app/artifacts',
        file
      )
    ).toEqual({ err: 'storage unavailable' })
  })
  it('does not upload without complete credentials', async () => {
    expect(
      await new OssArtifactStorage(new ConfigService({})).put(
        'app/artifacts',
        file
      )
    ).toEqual({ err: 'OSS initialization failed' })
    expect(put).not.toHaveBeenCalled()
  })
})
