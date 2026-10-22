export type ReleaseOperationContext = {
  requestId: string
  sourceIp?: string
  actorKeyId?: string
  actorType?: 'system' | 'api_key' | 'operator'
  actorName?: string
}
