export type TargetedMessageEnvelope = {
  messageId: string | null
  data: unknown
  updatedAt: string
  expiresAt: string | null
  ackRequired: boolean
}

export type UserMessageCommand = { userId: string; data?: unknown }
export type DeviceMessageCommand = {
  appName: string
  uniqueId: string
  data?: unknown
}
export type UserMessageAck = { userId: string; messageId: string }
export type DeviceMessageAck = {
  appName: string
  uniqueId: string
  messageId: string
}
