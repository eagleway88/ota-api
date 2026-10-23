import { parseUserId, userIdMatchesContext } from '@/contracts/user-id'

describe('userId contract', () => {
  it('preserves the complete business identifier', () => {
    expect(parseUserId('sample-app:windows:tenant:42')).toEqual({
      appName: 'sample-app',
      platform: 'windows',
      businessUserId: 'tenant:42'
    })
  })

  it('requires exact application and platform matches', () => {
    const userId = 'sample-app:windows:1'
    expect(userIdMatchesContext(userId, 'sample-app', 'windows')).toBe(true)
    expect(userIdMatchesContext(userId, 'sample-app-dev', 'windows')).toBe(
      false
    )
    expect(userIdMatchesContext(userId, 'sample-app', 'ios')).toBe(false)
  })

  it('rejects incomplete identifiers', () => {
    expect(parseUserId('sample-app:windows')).toBeNull()
    expect(parseUserId(':windows:1')).toBeNull()
    expect(parseUserId('sample-app::1')).toBeNull()
  })
})
