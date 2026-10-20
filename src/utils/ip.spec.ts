import type { Request } from 'express'
import { fetchIP, isRequestIpAllowed } from './index'

describe('trusted request IP', () => {
  it('uses the Express-computed address instead of raw forwarding headers', () => {
    const request = {
      ip: '203.0.113.5',
      headers: {
        'x-real-ip': '198.51.100.1',
        'x-forwarded-for': '198.51.100.2'
      }
    } as unknown as Request

    expect(fetchIP(request)).toBe('203.0.113.5')
    expect(isRequestIpAllowed(request, '203.0.113.5')).toBe(true)
    expect(isRequestIpAllowed(request, '198.51.100.1')).toBe(false)
  })

  it('normalizes local and IPv4-mapped addresses', () => {
    expect(fetchIP({ ip: '::1', headers: {} } as Request)).toBe('localhost')
    expect(fetchIP({ ip: '::ffff:192.0.2.1', headers: {} } as Request)).toBe(
      '192.0.2.1'
    )
  })
})
