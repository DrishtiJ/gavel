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
    phoneUserId: v.id('phoneUsers'),
    sandboxName: v.string(),
    image: v.string(),
    region: v.optional(v.string()),
    status: v.union(
      v.literal('creating'),
      v.literal('ready'),
      v.literal('error'),
    ),
    lastError: v.optional(v.string()),
    lastStartedAt: v.optional(v.number()),
    lastSeenAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_phoneUserId', ['phoneUserId'])
    .index('by_sandboxName', ['sandboxName']),
  agentRuns: defineTable({
    phoneUserId: v.id('phoneUsers'),
    browserProfileId: v.optional(v.id('browserProfiles')),
    sandboxName: v.optional(v.string()),
    inboundWebhookId: v.string(),
    agentPhoneConversationId: v.optional(v.string()),
    channel: v.union(v.literal('sms'), v.literal('mms'), v.literal('imessage')),
    prompt: v.string(),
    status: v.union(
      v.literal('needs_profile'),
      v.literal('queued'),
      v.literal('starting'),
      v.literal('running'),
      v.literal('completed'),
      v.literal('failed'),
    ),
    processName: v.optional(v.string()),
    processStatus: v.optional(v.string()),
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
})
