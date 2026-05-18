import { createHmac, timingSafeEqual } from 'node:crypto'

const ALLOWED_MESSAGE_CHANNELS = ['sms', 'mms', 'imessage'] as const

export type AgentPhoneMessageChannel = (typeof ALLOWED_MESSAGE_CHANNELS)[number]

export type AgentPhoneWebhookPayload = {
  event?: string
  channel?: string
  agentId?: string
  timestamp?: string
  data?: {
    conversationId?: string
    from?: string
    to?: string
    message?: string
    mediaUrl?: string | null
    mediaUrls?: string[]
    attachments?: AgentPhoneMediaItem[]
    media?: AgentPhoneMediaItem[]
    direction?: string
    receivedAt?: string
  }
}

export type AgentPhoneMediaItem = {
  url?: string | null
  mediaUrl?: string | null
  downloadUrl?: string | null
  contentType?: string | null
  mimeType?: string | null
  filename?: string | null
  fileName?: string | null
  name?: string | null
}

export function verifyAgentPhoneWebhook(input: {
  rawBody: string
  signature: string | null
  timestamp: string | null
  secret: string | undefined
  nowSeconds?: number
}) {
  if (!input.secret || !input.signature || !input.timestamp) return false

  const signedAt = Number.parseInt(input.timestamp, 10)
  if (!Number.isFinite(signedAt)) return false

  const nowSeconds = input.nowSeconds ?? Date.now() / 1000
  if (Math.abs(nowSeconds - signedAt) > 300) return false

  const expected =
    'sha256=' +
    createHmac('sha256', input.secret)
      .update(`${input.timestamp}.${input.rawBody}`)
      .digest('hex')

  const actualBuffer = Buffer.from(input.signature)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

export function normalizeAgentPhoneNumber(phoneNumber: string | undefined) {
  if (!phoneNumber) return null

  const normalized = phoneNumber.trim().replace(/[^\d+]/g, '')
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) return null

  return normalized
}

export function isSupportedMessageWebhook(
  payload: AgentPhoneWebhookPayload,
): payload is AgentPhoneWebhookPayload & {
  event: 'agent.message'
  channel: AgentPhoneMessageChannel
  data: NonNullable<AgentPhoneWebhookPayload['data']> & {
    from: string
    message?: string
  }
} {
  const data = payload.data
  const hasMedia =
    typeof data?.mediaUrl === 'string' ||
    (data?.mediaUrls?.length ?? 0) > 0 ||
    (data?.attachments?.length ?? 0) > 0 ||
    (data?.media?.length ?? 0) > 0

  return (
    payload.event === 'agent.message' &&
    ALLOWED_MESSAGE_CHANNELS.includes(
      payload.channel as AgentPhoneMessageChannel,
    ) &&
    typeof payload.data?.from === 'string' &&
    (typeof payload.data.message === 'string' || hasMedia)
  )
}
