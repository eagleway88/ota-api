import { createHash } from 'crypto'

/** Kept stable across prepare, migration and business writes. */
export function applicationPreparationLock(appName: string) {
  return `ota_app_prepare_${createHash('sha256').update(appName).digest('hex').slice(0, 40)}`
}
