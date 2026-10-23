import { isIP } from 'net'
import type { Request } from 'express'

function normalizeIpAddress(value?: string) {
  if (!value) return ''
  let ip = value.split(',')[0]?.trim() ?? ''
  if (!ip) return ''
  if (ip === 'localhost') return ip

  const bracketIpv6 = /^\[(.*)\]:(\d+)$/.exec(ip)
  if (bracketIpv6?.[1]) {
    ip = bracketIpv6[1]
  } else if (
    ip.includes('.') &&
    ip.includes(':') &&
    ip.indexOf(':') === ip.lastIndexOf(':')
  ) {
    ip = ip.split(':')[0] ?? ip
  }

  if (ip.startsWith('::ffff:')) {
    const ipv4 = ip.slice('::ffff:'.length)
    if (isIP(ipv4) === 4) ip = ipv4
  }

  if (ip === '::1' || ip === '127.0.0.1') return 'localhost'
  return isIP(ip) ? ip : ''
}

export function fetchIP(req: Request) {
  return normalizeIpAddress(req.ip)
}

/**
 * @param { Promise } promise
 * @param { Object= } errorExt - Additional Information you can pass to the err object
 * @return { Promise }
 */
export async function to<T, U = Error>(
  promise: Promise<T>,
  errorExt?: object
): Promise<[U, undefined] | [null, T]> {
  return promise
    .then<[null, T]>((data: T) => [null, data])
    .catch<[U, undefined]>((err: U) => {
      if (errorExt) {
        const parsedError = Object.assign({}, err, errorExt)
        return [parsedError, undefined]
      }
      return [err, undefined]
    })
}
