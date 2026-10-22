export type ReleaseOperationContext = {
  requestId: string
  sourceIp?: string
  actorAdminId?: number
  actorKeyId?: string
  actorType?: 'admin' | 'system' | 'api_key' | 'operator'
  actorName?: string
}
