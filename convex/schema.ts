import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

export default defineSchema({
  posts: defineTable({
    id: v.string(),
    title: v.string(),
    body: v.string(),
  }).index('id', ['id']),
  phoneUsers: defineTable({
    phoneNumber: v.string(),
    activeRunId: v.optional(v.id('agentRuns')),
    codexThreadId: v.optional(v.string()),
    resetBefore: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index('by_phoneNumber', ['phoneNumber']),
  browserProfiles: defineTable({
    phoneUserId: v.id('phoneUsers'),
    browserUseProfileId: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_phoneUserId', ['phoneUserId'])
    .index('by_browserUseProfileId', ['browserUseProfileId']),
  agentSandboxes: defineTable({
    phoneUserId: v.optional(v.id('phoneUsers')),
    sandboxName: v.string(),
    image: v.string(),
    region: v.optional(v.string()),
    poolRole: v.optional(v.union(v.literal('reserve'), v.literal('assigned'))),
    status: v.union(
      v.literal('creating'),
      v.literal('ready'),
      v.literal('error'),
    ),
    lastError: v.optional(v.string()),
    lastStartedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    assignedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_phoneUserId', ['phoneUserId'])
    .index('by_poolRole_and_status', ['poolRole', 'status'])
    .index('by_sandboxName', ['sandboxName']),
  agentRuns: defineTable({
    phoneUserId: v.id('phoneUsers'),
    browserProfileId: v.optional(v.id('browserProfiles')),
    sandboxName: v.optional(v.string()),
    inboundWebhookId: v.string(),
    agentPhoneConversationId: v.optional(v.string()),
    channel: v.union(v.literal('sms'), v.literal('mms'), v.literal('imessage')),
    prompt: v.string(),
    runtime: v.optional(v.union(v.literal('exec'), v.literal('app_server'))),
    codexThreadId: v.optional(v.string()),
    codexTurnId: v.optional(v.string()),
    status: v.union(
      v.literal('needs_profile'),
      v.literal('queued'),
      v.literal('starting'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('interrupted'),
    ),
    processName: v.optional(v.string()),
    processStatus: v.optional(v.string()),
    processLogOffset: v.optional(v.number()),
    agentReplyText: v.optional(v.string()),
    agentReplyItemId: v.optional(v.string()),
    agentReplyMediaUrls: v.optional(v.array(v.string())),
    replyDeliveryStatus: v.optional(
      v.union(v.literal('pending'), v.literal('sent'), v.literal('failed')),
    ),
    replyDeliveryError: v.optional(v.string()),
    replySentAt: v.optional(v.number()),
    agentPhoneMessageId: v.optional(v.string()),
    agentPhoneMessageIds: v.optional(v.array(v.string())),
    completedAt: v.optional(v.number()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_phoneUserId', ['phoneUserId'])
    .index('by_inboundWebhookId', ['inboundWebhookId']),
  agentRunEvents: defineTable({
    runId: v.id('agentRuns'),
    sequence: v.number(),
    type: v.string(),
    message: v.string(),
    createdAt: v.number(),
  }).index('by_runId_and_sequence', ['runId', 'sequence']),
  conversationMessages: defineTable({
    phoneUserId: v.id('phoneUsers'),
    runId: v.optional(v.id('agentRuns')),
    inboundWebhookId: v.optional(v.string()),
    direction: v.union(
      v.literal('user'),
      v.literal('agent'),
      v.literal('system'),
      v.literal('external'),
    ),
    externalSource: v.optional(v.string()),
    channel: v.optional(
      v.union(v.literal('sms'), v.literal('mms'), v.literal('imessage')),
    ),
    body: v.string(),
    attachmentCount: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_phoneUserId_createdAt', ['phoneUserId', 'createdAt'])
    .index('by_inboundWebhookId', ['inboundWebhookId'])
    .index('by_runId', ['runId']),
  conversationAttachments: defineTable({
    phoneUserId: v.id('phoneUsers'),
    conversationMessageId: v.id('conversationMessages'),
    runId: v.optional(v.id('agentRuns')),
    inboundWebhookId: v.string(),
    storageId: v.id('_storage'),
    sourceUrl: v.optional(v.string()),
    filename: v.optional(v.string()),
    contentType: v.optional(v.string()),
    size: v.optional(v.number()),
    sha256: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_phoneUserId', ['phoneUserId'])
    .index('by_conversationMessageId', ['conversationMessageId'])
    .index('by_inboundWebhookId', ['inboundWebhookId'])
    .index('by_runId', ['runId']),
  inboundMessageBuffer: defineTable({
    webhookId: v.string(),
    phoneNumber: v.string(),
    channel: v.union(v.literal('sms'), v.literal('mms'), v.literal('imessage')),
    prompt: v.string(),
    conversationId: v.optional(v.string()),
    attachments: v.array(
      v.object({
        storageId: v.id('_storage'),
        sourceUrl: v.optional(v.string()),
        filename: v.optional(v.string()),
        contentType: v.optional(v.string()),
        size: v.optional(v.number()),
        sha256: v.optional(v.string()),
      }),
    ),
    status: v.union(
      v.literal('pending'),
      v.literal('processing'),
      v.literal('processed'),
    ),
    processAfter: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_webhookId', ['webhookId'])
    .index('by_phoneNumber_status_processAfter', [
      'phoneNumber',
      'status',
      'processAfter',
    ]),
  listings: defineTable({
    title: v.string(),
    description: v.string(),
    askingPrice: v.number(),
    currency: v.string(),
    status: v.union(v.literal('active'), v.literal('sold')),
    embedding: v.optional(v.array(v.float64())),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_status', ['status'])
    .vectorIndex('by_embedding', {
      vectorField: 'embedding',
      dimensions: 768,
      filterFields: ['status'],
    }),
  bookings: defineTable({
    listingId: v.id('listings'),
    slotIso: v.string(),
    finalPrice: v.number(),
    customerPhone: v.optional(v.string()),
    callId: v.optional(v.string()),
    createdAt: v.number(),
  }).index('by_listingId', ['listingId']),
})
