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

const conversationHistoryLimit = 30

type ConversationMessage = {
  role: 'user' | 'agent' | 'system'
  body: string
  createdAt: number
}

type StartableQueuedRun = {
  runId: Id<'agentRuns'>
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type InterruptedRun = {
  runId: Id<'agentRuns'>
  sandboxName?: string
  processName?: string
}

type StartableAppServerRun = {
  kind: 'start'
  runId: Id<'agentRuns'>
  phoneUserId: Id<'phoneUsers'>
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type SteerableAppServerRun = {
  kind: 'steer'
  runId: Id<'agentRuns'>
  phoneUserId: Id<'phoneUsers'>
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
  codexThreadId: string
  codexTurnId: string
  conversationHistory: ConversationMessage[]
}

type AppServerEnqueueResult =
  | {
      kind: 'duplicate'
      runId?: Id<'agentRuns'>
      status?: string
    }
  | {
      kind: 'needs_profile'
      runId: Id<'agentRuns'>
      phoneUserId: Id<'phoneUsers'>
      phoneNumber: string
      prompt: string
    }
  | StartableAppServerRun
  | SteerableAppServerRun

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

const getBrowserProfile = async (
  ctx: MutationCtx,
  phoneUserId: Id<'phoneUsers'>,
) => {
  return await ctx.db
    .query('browserProfiles')
    .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUserId))
    .first()
}

const getConversationHistory = async (
  ctx: MutationCtx,
  phoneUserId: Id<'phoneUsers'>,
): Promise<ConversationMessage[]> => {
  const messages = await ctx.db
    .query('conversationMessages')
    .withIndex('by_phoneUserId_createdAt', (q) =>
      q.eq('phoneUserId', phoneUserId),
    )
    .order('desc')
    .take(conversationHistoryLimit)

  return messages.reverse().map((message) => ({
    role: message.direction,
    body: message.body,
    createdAt: message.createdAt,
  }))
}

const startNextQueuedRun = async (
  ctx: MutationCtx,
  phoneUserId: Id<'phoneUsers'>,
): Promise<StartableQueuedRun | null> => {
  const timestamp = now()
  const phoneUser = await ctx.db.get(phoneUserId)
  if (!phoneUser) return null

  const nextRun = await ctx.db
    .query('agentRuns')
    .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUserId))
    .filter((q) => q.eq(q.field('status'), 'queued'))
    .order('asc')
    .first()

  if (!nextRun) {
    await ctx.db.patch(phoneUserId, {
      activeRunId: undefined,
      updatedAt: timestamp,
    })
    return null
  }

  const browserProfile = await getBrowserProfile(ctx, phoneUserId)
  if (!browserProfile) {
    await ctx.db.patch(nextRun._id, {
      status: 'needs_profile',
      updatedAt: timestamp,
    })
    await addRunEvent(
      ctx,
      nextRun._id,
      'needs_profile',
      'Browser Use profile is missing for this phone number',
    )
    return await startNextQueuedRun(ctx, phoneUserId)
  }

  await ctx.db.patch(phoneUserId, {
    activeRunId: nextRun._id,
    updatedAt: timestamp,
  })
  await addRunEvent(ctx, nextRun._id, 'queued', 'Starting queued follow-up')

  return {
    runId: nextRun._id,
    phoneNumber: phoneUser.phoneNumber,
    prompt: nextRun.prompt,
    browserUseProfileId: browserProfile.browserUseProfileId,
    codexThreadId: phoneUser.codexThreadId,
    conversationHistory: await getConversationHistory(ctx, phoneUserId),
  }
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

    const browserProfile = await getBrowserProfile(ctx, phoneUser._id)

    let activeRunId = phoneUser.activeRunId
    let interruptedRun: InterruptedRun | undefined
    let codexThreadId = phoneUser.codexThreadId
    if (activeRunId) {
      const activeRun = await ctx.db.get(activeRunId)
      if (!activeRun || !activeRunStatuses.has(activeRun.status)) {
        activeRunId = undefined
        await ctx.db.patch(phoneUser._id, {
          activeRunId: undefined,
          updatedAt: timestamp,
        })
      } else {
        codexThreadId = codexThreadId ?? activeRun.codexThreadId
        interruptedRun = {
          runId: activeRun._id,
          sandboxName: activeRun.sandboxName,
          processName: activeRun.processName,
        }
        await ctx.db.patch(activeRun._id, {
          status: 'interrupted',
          completedAt: timestamp,
          updatedAt: timestamp,
        })
        await addRunEvent(
          ctx,
          activeRun._id,
          'interrupted',
          'Interrupted by a newer user message',
        )
        activeRunId = undefined
      }
    }

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId: browserProfile?._id,
      inboundWebhookId: args.webhookId,
      agentPhoneConversationId: args.conversationId,
      channel: args.channel,
      prompt: args.prompt,
      runtime: 'exec',
      codexThreadId,
      status: browserProfile ? 'queued' : 'needs_profile',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await ctx.db.insert('conversationMessages', {
      phoneUserId: phoneUser._id,
      runId,
      inboundWebhookId: args.webhookId,
      direction: 'user',
      channel: args.channel,
      body: args.prompt,
      createdAt: timestamp,
    })

    if (browserProfile) {
      await ctx.db.patch(phoneUser._id, {
        activeRunId: runId,
        codexThreadId,
        updatedAt: timestamp,
      })
    }

    const queueMessage = !browserProfile
      ? 'Browser Use profile is missing for this phone number'
      : interruptedRun
        ? 'Queued steering run after interrupting previous remote Codex run'
        : 'Queued remote Codex run'

    await addRunEvent(
      ctx,
      runId,
      browserProfile ? 'queued' : 'needs_profile',
      queueMessage,
    )

    return {
      kind: !browserProfile ? ('needs_profile' as const) : ('queued' as const),
      runId,
      phoneUserId: phoneUser._id,
      phoneNumber: phoneUser.phoneNumber,
      prompt: args.prompt,
      browserUseProfileId: browserProfile?.browserUseProfileId,
      codexThreadId,
      conversationHistory: await getConversationHistory(ctx, phoneUser._id),
      interruptedRun,
    }
  },
})

export const enqueueAgentPhoneMessageForAppServer = mutation({
  args: {
    webhookId: v.string(),
    phoneNumber: v.string(),
    channel: messageChannel,
    prompt: v.string(),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AppServerEnqueueResult> => {
    const duplicateMessage = await ctx.db
      .query('conversationMessages')
      .withIndex('by_inboundWebhookId', (q) =>
        q.eq('inboundWebhookId', args.webhookId),
      )
      .first()

    if (duplicateMessage) {
      const duplicateRun = duplicateMessage.runId
        ? await ctx.db.get(duplicateMessage.runId)
        : null
      return {
        kind: 'duplicate',
        runId: duplicateMessage.runId,
        status: duplicateRun?.status,
      }
    }

    const duplicateRun = await ctx.db
      .query('agentRuns')
      .withIndex('by_inboundWebhookId', (q) =>
        q.eq('inboundWebhookId', args.webhookId),
      )
      .first()

    if (duplicateRun) {
      return {
        kind: 'duplicate',
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

    const browserProfile = await getBrowserProfile(ctx, phoneUser._id)
    if (!browserProfile) {
      const runId = await ctx.db.insert('agentRuns', {
        phoneUserId: phoneUser._id,
        inboundWebhookId: args.webhookId,
        agentPhoneConversationId: args.conversationId,
        channel: args.channel,
        prompt: args.prompt,
        runtime: 'app_server',
        status: 'needs_profile',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      await ctx.db.insert('conversationMessages', {
        phoneUserId: phoneUser._id,
        runId,
        inboundWebhookId: args.webhookId,
        direction: 'user',
        channel: args.channel,
        body: args.prompt,
        createdAt: timestamp,
      })
      await addRunEvent(
        ctx,
        runId,
        'needs_profile',
        'Browser Use profile is missing for this phone number',
      )
      return {
        kind: 'needs_profile',
        runId,
        phoneUserId: phoneUser._id,
        phoneNumber: phoneUser.phoneNumber,
        prompt: args.prompt,
      }
    }

    const activeRun = phoneUser.activeRunId
      ? await ctx.db.get(phoneUser.activeRunId)
      : null

    if (
      activeRun &&
      activeRun.runtime === 'app_server' &&
      activeRun.status === 'running' &&
      activeRun.codexThreadId &&
      activeRun.codexTurnId
    ) {
      await ctx.db.insert('conversationMessages', {
        phoneUserId: phoneUser._id,
        runId: activeRun._id,
        inboundWebhookId: args.webhookId,
        direction: 'user',
        channel: args.channel,
        body: args.prompt,
        createdAt: timestamp,
      })
      await addRunEvent(
        ctx,
        activeRun._id,
        'steer_requested',
        `Steering active turn with webhook ${args.webhookId}`,
      )

      return {
        kind: 'steer',
        runId: activeRun._id,
        phoneUserId: phoneUser._id,
        phoneNumber: phoneUser.phoneNumber,
        prompt: args.prompt,
        browserUseProfileId: browserProfile.browserUseProfileId,
        codexThreadId: activeRun.codexThreadId,
        codexTurnId: activeRun.codexTurnId,
        conversationHistory: await getConversationHistory(ctx, phoneUser._id),
      }
    }

    if (phoneUser.activeRunId && !activeRun) {
      await ctx.db.patch(phoneUser._id, {
        activeRunId: undefined,
        updatedAt: timestamp,
      })
    }

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId: browserProfile._id,
      inboundWebhookId: args.webhookId,
      agentPhoneConversationId: args.conversationId,
      channel: args.channel,
      prompt: args.prompt,
      runtime: 'app_server',
      codexThreadId: phoneUser.codexThreadId,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    await ctx.db.insert('conversationMessages', {
      phoneUserId: phoneUser._id,
      runId,
      inboundWebhookId: args.webhookId,
      direction: 'user',
      channel: args.channel,
      body: args.prompt,
      createdAt: timestamp,
    })

    await ctx.db.patch(phoneUser._id, {
      activeRunId: runId,
      updatedAt: timestamp,
    })

    await addRunEvent(
      ctx,
      runId,
      'queued',
      phoneUser.codexThreadId
        ? 'Queued app-server follow-up turn'
        : 'Queued first app-server turn',
    )

    return {
      kind: 'start',
      runId,
      phoneUserId: phoneUser._id,
      phoneNumber: phoneUser.phoneNumber,
      prompt: args.prompt,
      browserUseProfileId: browserProfile.browserUseProfileId,
      codexThreadId: phoneUser.codexThreadId,
      conversationHistory: await getConversationHistory(ctx, phoneUser._id),
    }
  },
})

export const markRunStarting = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    image: v.string(),
    region: v.optional(v.string()),
    codexThreadId: v.optional(v.string()),
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
      codexThreadId: args.codexThreadId ?? run.codexThreadId,
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
      processLogOffset: 0,
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

export const markAppServerRunStarting = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    image: v.string(),
    region: v.optional(v.string()),
    processName: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')

    const timestamp = now()
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
      processName: args.processName,
      processStatus: 'starting',
      status: 'starting',
      updatedAt: timestamp,
    })
    await addRunEvent(
      ctx,
      args.runId,
      'starting',
      'Starting Codex app-server sandbox runtime',
    )
  },
})

export const markAppServerTurnStarted = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    processName: v.string(),
    codexThreadId: v.string(),
    codexTurnId: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')

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
      sandboxName: args.sandboxName,
      processName: args.processName,
      processStatus: 'running',
      codexThreadId: args.codexThreadId,
      codexTurnId: args.codexTurnId,
      status: 'running',
      updatedAt: timestamp,
    })

    const phoneUser = await ctx.db.get(run.phoneUserId)
    if (phoneUser) {
      await ctx.db.patch(phoneUser._id, {
        activeRunId: args.runId,
        codexThreadId: args.codexThreadId,
        updatedAt: timestamp,
      })
    }

    await addRunEvent(
      ctx,
      args.runId,
      'running',
      `Started app-server turn ${args.codexTurnId}`,
    )
  },
})

export const markAppServerSteerAccepted = mutation({
  args: {
    runId: v.id('agentRuns'),
    codexTurnId: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')

    await ctx.db.patch(args.runId, {
      codexTurnId: args.codexTurnId,
      updatedAt: now(),
    })
    await addRunEvent(
      ctx,
      args.runId,
      'steer_accepted',
      `Steered active app-server turn ${args.codexTurnId}`,
    )
  },
})

export const markAppServerTurnCompleted = mutation({
  args: {
    runId: v.id('agentRuns'),
    processStatus: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running') return

    const timestamp = now()
    await ctx.db.patch(args.runId, {
      status: 'completed',
      processStatus: args.processStatus ?? 'idle',
      completedAt: timestamp,
      updatedAt: timestamp,
    })

    const phoneUser = await ctx.db.get(run.phoneUserId)
    if (phoneUser?.activeRunId === args.runId) {
      await ctx.db.patch(phoneUser._id, {
        activeRunId: undefined,
        updatedAt: timestamp,
      })
    }

    await addRunEvent(
      ctx,
      args.runId,
      'completed',
      'Codex app-server turn completed',
    )
  },
})

export const appendRunProgress = mutation({
  args: {
    runId: v.id('agentRuns'),
    processStatus: v.optional(v.string()),
    processLogOffset: v.number(),
    codexThreadId: v.optional(v.string()),
    events: v.array(
      v.object({
        type: v.string(),
        message: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const timestamp = now()
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')
    if (run.status !== 'running') return

    await ctx.db.patch(args.runId, {
      processStatus: args.processStatus ?? run.processStatus,
      processLogOffset: args.processLogOffset,
      codexThreadId: args.codexThreadId ?? run.codexThreadId,
      updatedAt: timestamp,
    })

    if (args.codexThreadId) {
      const phoneUser = await ctx.db.get(run.phoneUserId)
      if (phoneUser && phoneUser.codexThreadId !== args.codexThreadId) {
        await ctx.db.patch(phoneUser._id, {
          codexThreadId: args.codexThreadId,
          updatedAt: timestamp,
        })
      }
    }

    for (const event of args.events) {
      await addRunEvent(ctx, args.runId, event.type, event.message)
    }
  },
})

export const markRunCompleted = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.string(),
    processName: v.string(),
    processStatus: v.string(),
    processLogOffset: v.number(),
  },
  handler: async (ctx, args): Promise<StartableQueuedRun | null> => {
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')
    if (run.status === 'interrupted') return null

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
      status: 'completed',
      processName: args.processName,
      processStatus: args.processStatus,
      processLogOffset: args.processLogOffset,
      completedAt: timestamp,
      updatedAt: timestamp,
    })

    const phoneUser = await ctx.db.get(run.phoneUserId)
    await addRunEvent(
      ctx,
      args.runId,
      'completed',
      'Remote Codex run completed',
    )
    if (phoneUser?.activeRunId === args.runId) {
      return await startNextQueuedRun(ctx, phoneUser._id)
    }

    return null
  },
})

export const markRunFailed = mutation({
  args: {
    runId: v.id('agentRuns'),
    sandboxName: v.optional(v.string()),
    error: v.string(),
  },
  handler: async (ctx, args): Promise<StartableQueuedRun | null> => {
    const timestamp = now()
    const run = await ctx.db.get(args.runId)
    if (!run) throw new Error('agent run not found')
    if (run.status === 'interrupted') return null

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
    const phoneUser = await ctx.db.get(run.phoneUserId)
    if (phoneUser?.activeRunId === args.runId) {
      await addRunEvent(ctx, args.runId, 'failed', args.error)
      return await startNextQueuedRun(ctx, phoneUser._id)
    }
    await addRunEvent(ctx, args.runId, 'failed', args.error)
    return null
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
