import { DataSource } from 'typeorm'
import { ApiKeyService, generateApiKey } from '@/auth/api-key.service'

describe('API key authentication boundary', () => {
  it.each(['', 'invalid-credential', 'ota_ak_invalid', 'Bearer secret'])(
    'rejects malformed credentials without accessing storage: %s',
    async token => {
      const source = { query: jest.fn() }
      await expect(
        new ApiKeyService(source as unknown as DataSource).authenticate(token)
      ).rejects.toThrow('Invalid access key')
      expect(source.query).not.toHaveBeenCalled()
    }
  )
  it('fails closed when authorization storage is unavailable and never sends the secret to SQL', async () => {
    const key = generateApiKey(),
      source = {
        query: jest.fn().mockRejectedValue(new Error('database unavailable'))
      }
    await expect(
      new ApiKeyService(source as unknown as DataSource).authenticate(
        key.accessKey
      )
    ).rejects.toThrow('database unavailable')
    expect(JSON.stringify(source.query.mock.calls)).not.toContain(
      key.accessKey.split('.')[1]
    )
  })
  it('recognizes a valid credential with no application grants without granting access', async () => {
    const key = generateApiKey()
    const source = {
      query: jest.fn().mockResolvedValue([
        {
          key_id: key.keyId,
          name: 'CI',
          secret_hash: key.secretHash,
          preset: 'full',
          app_name: null
        }
      ])
    }
    expect(
      await new ApiKeyService(source as unknown as DataSource).authenticate(
        key.accessKey
      )
    ).toMatchObject({ keyId: key.keyId, applications: [] })
  })
})
