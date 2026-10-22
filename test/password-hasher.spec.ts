import { PasswordHasher } from '@/auth/password-hasher'

describe('PasswordHasher', () => {
  const hasher = new PasswordHasher()

  it('hashes and verifies without retaining the password', async () => {
    const hash = await hasher.hash('correct horse battery staple')
    expect(hash).not.toContain('correct horse battery staple')
    await expect(
      hasher.verify('correct horse battery staple', hash)
    ).resolves.toEqual({ valid: true, needsRehash: false })
    await expect(hasher.verify('wrong', hash)).resolves.toEqual({
      valid: false,
      needsRehash: false
    })
  })

  it('accepts a legacy plaintext password once and requests migration', async () => {
    await expect(hasher.verify('legacy', 'legacy')).resolves.toEqual({
      valid: true,
      needsRehash: true
    })
  })
})
