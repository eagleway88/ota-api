import { SetMetadata } from '@nestjs/common'

export const apiPermissions = [
  'releases:read',
  'releases:write',
  'telemetry:read',
  'tasks:read',
  'audit:read',
  'messages:read',
  'messages:send'
] as const
export type ApiPermission = (typeof apiPermissions)[number]
export const apiKeyPresets = {
  publisher: ['releases:read', 'releases:write', 'tasks:read'],
  observer: ['releases:read', 'telemetry:read', 'tasks:read', 'audit:read'],
  messenger: ['messages:read', 'messages:send'],
  full: apiPermissions
} as const satisfies Record<string, readonly ApiPermission[]>
export type ApiKeyPreset = keyof typeof apiKeyPresets
export const MAX_API_KEY_APPLICATIONS = 100
export const API_PERMISSION = 'ota:apiPermission'
export const RequirePermission = (permission: ApiPermission) =>
  SetMetadata(API_PERMISSION, permission)
export function isApiKeyPreset(value: string): value is ApiKeyPreset {
  return Object.hasOwn(apiKeyPresets, value)
}
export function validApiKeyName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    Boolean(value.trim()) &&
    value.length <= 128 &&
    ![...value].some(
      char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
    )
  )
}
export type ApiKeyPrincipal = {
  type: 'api_key'
  keyId: string
  name: string
  preset: ApiKeyPreset
  applications: readonly string[]
}
export function permits(
  principal: ApiKeyPrincipal,
  appName: string,
  permission: ApiPermission
) {
  return (
    principal.applications.includes(appName) &&
    (apiKeyPresets[principal.preset] as readonly ApiPermission[]).includes(
      permission
    )
  )
}
