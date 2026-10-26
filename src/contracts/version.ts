/** Canonical display version used by OTA, e.g. 1.3.10. */
export const APP_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
export function isAppVersion(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 128 &&
    APP_VERSION_PATTERN.test(value)
  )
}
/** Compare numeric components without integer overflow or lexical version ordering. */
export function compareVersions(left: string, right: string): number {
  if (!isAppVersion(left) || !isAppVersion(right))
    throw new Error('Invalid display version')
  const a = left.split('.'),
    b = right.split('.')
  for (let i = 0; i < 3; i++) {
    if (a[i].length !== b[i].length) return a[i].length > b[i].length ? 1 : -1
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}
