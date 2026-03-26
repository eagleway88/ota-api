import { isIP } from 'net'
import type { Request } from 'express'

function normalizeIpAddress(value?: string) {
  if (!value) return ''
  let ip = value.split(',')[0]?.trim() ?? ''
  if (!ip) return ''

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
  const xRealIp = normalizeIpAddress(req.headers['x-real-ip'] as string | undefined)
  if (xRealIp) return xRealIp

  const xForwardedFor = normalizeIpAddress(
    req.headers['x-forwarded-for'] as string | undefined
  )
  if (xForwardedFor) return xForwardedFor

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

function isPlainObject(value: unknown): value is Record<string, any> {
  if (Object.prototype.toString.call(value) !== '[object Object]') {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/**
 * 下划线转驼峰 (CamelCase)
 */
export function underlineToHump(obj: any) {
  if (obj === null || obj === undefined) return obj;

  // 递归处理数组或对象
  if (Array.isArray(obj)) {
    return obj.map(v => underlineToHump(v));
  }

  if (!isPlainObject(obj)) return obj;

  return Object.keys(obj).reduce((newObj, key) => {
    // 使用正则匹配下划线，将其后第一个字母转为大写
    let newKey = key.replace(/_(\w)/g, (all, letter) => letter.toUpperCase());
    newObj[newKey] = underlineToHump(obj[key]); // 递归
    return newObj;
  }, {});
}

/**
 * 驼峰转下划线 (SnakeCase)
 */
export function humpToUnderline(obj: any) {
  if (obj === null || obj === undefined) return obj;

  if (Array.isArray(obj)) {
    return obj.map(v => humpToUnderline(v));
  }

  if (!isPlainObject(obj)) return obj;

  return Object.keys(obj).reduce((newObj, key) => {
    // 使用正则匹配大写字母，并在其前添加下划线
    let newKey = key.replace(/([A-Z])/g, "_$1").toLowerCase();
    newObj[newKey] = humpToUnderline(obj[key]); // 递归
    return newObj;
  }, {});
}