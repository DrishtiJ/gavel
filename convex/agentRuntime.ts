import { v } from 'convex/values'
import { mutation, query } from './_generated/server'
import type { Id } from './_generated/dataModel'
import type { MutationCtx } from './_generated/server'

const messageChannel = v.union(
  v.literal('sms'),
  v.literal('mms'),
  v.literal('imessage'),
)

const now = () => Date.now()

const activeRunStatuses = new Set(['queued', 'starting', 'running'])

const nextEventSequence = async (ctx: MutationCtx, runId: Id<'agentRuns'>) => {
  const latest = await ctx.db
    .query('agentRunEvents')
    .withIndex('by_runId_and_sequence', (q) => q.eq('runId', runId))
    .order('desc')
    .first()

  return latest ? latest.sequence + 1 : 1
}

const addRunEvent = async (
  ctx: MutationCtx,
  runId: Id<'agentRuns'>,
  type: string,
  message: string,
) => {
  await ctx.db.insert('agentRunEvents', {
    runId,
    sequence: await nextEventSequence(ctx, runId),
    type,
    message,
    createdAt: now(),
  })
}

export const enqueueAgentPhoneMessage = mutation({
  args: {
    webhookId: v.string(),
    phoneNumber: v.string(),
    channel: messageChannel,
    prompt: v.string(),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const duplicateRun = await ctx.db
      .query('agentRuns')
      .withIndex('by_inboundWebhookId', (q) =>
        q.eq('inboundWebhookId', args.webhookId),
      )
      .first()

    if (duplicateRun) {
      return {
        kind: 'duplicate' as const,
        runId: duplicateRun._id,
        status: duplicateRun.status,
      }
    }

    const timestamp = now()
    let phoneUser = await ctx.db
      .query('phoneUsers')
      .withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', args.phoneNumber))
      .first()

    if (!phoneUser) {
      const phoneUserId = await ctx.db.insert('phoneUsers', {
        phoneNumber: args.phoneNumber,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      phoneUser = (await ctx.db.get(phoneUserId))!
    } else {
      await ctx.db.patch(phoneUser._id, { updatedAt: timestamp })
    }

    const browserProfile = await ctx.db
      .query('browserProfiles')
      .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUser._id))
      .first()

    let activeRunId = phoneUser.activeRunId
    if (activeRunId) {
      const activeRun = await ctx.db.get(activeRunId)
      if (!activeRun || !activeRunStatuses.has(activeRun.status)) {
        activeRunId = undefined
        await ctx.db.patch(phoneUser._id, {
          activeRunId: undefined,
          updatedAt: timestamp,
        })
      }
    }

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId: browserProfile?._id,
      inboundWebhookId: args.webhookId,
      agentPhoneConversationId: args.conversationId,
      channel: args.channel,
      prompt: args.prompt,
      status: browserProfile ? 'queued' : 'needs_profile',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    if (browserProfile && !activeRunId) {
      await ctx.db.patch(phoneUser._id, {
        activeRunId: runId,
        updatedAt: timestamp,
      })
    }

    const queueMessage = !browserProfile
      ? 'Browser Use profile is missing for this phone number'
      : activeRunId
        ? 'Queued behind active remote Codex run'
        : 'Queued remote Codex run'

    await addRunEvent(
      ctx,
      runId,
      browserProfile ? 'queued' : 'needs_profile',
      queueMessage,
    )

    return {
      kind: !browserProfile
        ? ('needs_profile' as const)
        : activeRunId
          ? ('queued_waiting' as const)
          : ('queued' as const),
      runId,
      phoneUserId: phoneUser._id,
      phoneNumber: phoneUser.phoneNumber,
      prompt: args.prompt,
      browserUseProfileId: browserProfile?.browserUseProfileId,
      activeRunId,
    }
  },
})

export const markRunStarting = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    image: v.string(),
    region: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')

    const timestamp = now()
    const phoneUser = await ctx.db.get(run.phoneUserId)
    if (!phoneUser) throw new Error('phone user not found')
    if (run.status !== 'queued') {
      throw new Error(`agent run is not startable from ${run.status}`)
    }
    if (phoneUser.activeRunId !== args.runId) {
      throw new Error('agent run is queued behind another active run')
    }

    const existingSandbox = await ctx.db
      .query('agentSandboxes')
      .withIndex('by_sandboxName', (q) => q.eq('sandboxName', args.sandboxName))
      .first()

    if (existingSandbox) {
      await ctx.db.patch(existingSandbox._id, {
        image: args.image,
        region: args.region,
        status: 'creating',
        lastError: undefined,
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        updatedAt: timestamp,
      })
    } else {
      await ctx.db.insert('agentSandboxes', {
        phoneUserId: run.phoneUserId,
        sandboxName: args.sandboxName,
        image: args.image,
        region: args.region,
        status: 'creating',
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    await ctx.db.patch(args.runId, {
      sandboxName: args.sandboxName,
      status: 'starting',
      updatedAt: timestamp,
    })
    await addRunEvent(ctx, args.runId, 'starting', 'Starting Blaxel sandbox')
  },
})

export const markRunRemoteStarted = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    processName: v.string(),
    processStatus: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now()
    const sandbox = await ctx.db
      .query('agentSandboxes')
      .withIndex('by_sandboxName', (q) => q.eq('sandboxName', args.sandboxName))
      .first()

    if (sandbox) {
      await ctx.db.patch(sandbox._id, {
        status: 'ready',
        lastError: undefined,
        lastSeenAt: timestamp,
        updatedAt: timestamp,
      })
    }

    await ctx.db.patch(args.runId, {
      status: 'running',
      processName: args.processName,
      processStatus: args.processStatus,
      updatedAt: timestamp,
    })
    await addRunEvent(
      ctx,
      args.runId,
      'running',
      `Started remote process ${args.processName}`,
    )
  },
})

export const markRunFailed = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.optional(v.string()),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now()
    if (args.sandboxName) {
      const sandbox = await ctx.db
        .query('agentSandboxes')
        .withIndex('by_sandboxName', (q) =>
          q.eq('sandboxName', args.sandboxName!),
        )
        .first()

      if (sandbox) {
        await ctx.db.patch(sandbox._id, {
          status: 'error',
          lastError: args.error,
          lastSeenAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }

    await ctx.db.patch(args.runId, {
      status: 'failed',
      error: args.error,
      updatedAt: timestamp,
    })
    const run = await ctx.db.get(args.runId)
    if (run) {
      const phoneUser = await ctx.db.get(run.phoneUserId)
      if (phoneUser?.activeRunId === args.runId) {
        await ctx.db.patch(phoneUser._id, {
          activeRunId: undefined,
          updatedAt: timestamp,
        })
      }
    }
    await addRunEvent(ctx, args.runId, 'failed', args.error)
  },
})

export const setBrowserProfileForPhone = mutation({
  args: {
    phoneNumber: v.string(),
    browserUseProfileId: v.string(),
  },
  handler: async (ctx, args) => {
    const timestamp = now()
    let phoneUser = await ctx.db
      .query('phoneUsers')
      .withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', args.phoneNumber))
      .first()

    if (!phoneUser) {
      const phoneUserId = await ctx.db.insert('phoneUsers', {
        phoneNumber: args.phoneNumber,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      phoneUser = (await ctx.db.get(phoneUserId))!
    }

    const existing = await ctx.db
      .query('browserProfiles')
      .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUser._id))
      .first()

    if (existing) {
      await ctx.db.patch(existing._id, {
        browserUseProfileId: args.browserUseProfileId,
        updatedAt: timestamp,
      })
      return existing._id
    }

    return await ctx.db.insert('browserProfiles', {
      phoneUserId: phoneUser._id,
      browserUseProfileId: args.browserUseProfileId,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
  },
})

export const listRunsForPhone = query({
  args: {
    phoneNumber: v.string(),
  },
  handler: async (ctx, args) => {
    const phoneUser = await ctx.db
      .query('phoneUsers')
      .withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', args.phoneNumber))
      .first()

    if (!phoneUser) return []

    return await ctx.db
      .query('agentRuns')
      .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUser._id))
      .order('desc')
      .take(20)
  },
})
