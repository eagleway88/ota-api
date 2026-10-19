import { parseUserId, userIdMatchesContext } from './user-id'

describe('userId contract', () => {
  it('preserves the complete business identifier', () => {
    expect(parseUserId('eagleway-network:windows:tenant:42')).toEqual({
      appName: 'eagleway-network',
      platform: 'windows',
      businessUserId: 'tenant:42'
    })
  })

  it('requires exact application and platform matches', () => {
    const userId = 'eagleway-network:windows:1'
    expect(userIdMatchesContext(userId, 'eagleway-network', 'windows')).toBe(
      true
    )
    expect(
      userIdMatchesContext(userId, 'eagleway-network-dev', 'windows')
    ).toBe(false)
    expect(userIdMatchesContext(userId, 'eagleway-network', 'ios')).toBe(false)
  })

  it('rejects incomplete identifiers', () => {
    expect(parseUserId('eagleway-network:windows')).toBeNull()
    expect(parseUserId(':windows:1')).toBeNull()
    expect(parseUserId('eagleway-network::1')).toBeNull()
  })
})
