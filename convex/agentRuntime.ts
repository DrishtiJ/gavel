import { v } from 'convex/values'
import { internalMutation, mutation, query } from './_generated/server'
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

const attachmentInput = v.object({
  storageId: v.id('_storage'),
  sourceUrl: v.optional(v.string()),
  filename: v.optional(v.string()),
  contentType: v.optional(v.string()),
  size: v.optional(v.number()),
  sha256: v.optional(v.string()),
})

type ConversationMessage = {
  role: 'user' | 'agent' | 'system' | 'external'
  body: string
  imageUrls?: string[]
  createdAt: number
}

type MessageAttachmentInput = {
  storageId: Id<'_storage'>
  sourceUrl?: string
  filename?: string
  contentType?: string
  size?: number
  sha256?: string
}

type ConversationDirection = 'user' | 'agent' | 'system' | 'external'

type FormattedMessageInput = {
  body: string
  imageUrls: string[]
}

type BrowserProfileResolution =
  | {
      source: 'phone'
      browserProfileId: Id<'browserProfiles'>
      browserUseProfileId: string
    }
  | {
      source: 'default'
      browserUseProfileId: string
    }

type StartableQueuedRun = {
  runId: Id<'agentRuns'>
  phoneNumber: string
  sandboxName?: string
  prompt: string
  imageUrls?: string[]
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
  sandboxName?: string
  prompt: string
  imageUrls?: string[]
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type SteerableAppServerRun = {
  kind: 'steer'
  runId: Id<'agentRuns'>
  phoneUserId: Id<'phoneUsers'>
  phoneNumber: string
  sandboxName?: string
  prompt: string
  imageUrls?: string[]
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

function normalizePhoneNumber(phoneNumber: string) {
  const normalized = phoneNumber.trim().replace(/[^\d+]/g, '')
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) {
    throw new Error('Phone number must be in E.164 format, e.g. +16505551234')
  }
  return normalized
}

async function requireAdmin(ctx: MutationCtx, adminSecret: string | undefined) {
  const identity = await ctx.auth.getUserIdentity()
  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)

  const email =
    typeof identity?.email === 'string' ? identity.email.toLowerCase() : null
  if (email && adminEmails.includes(email)) return

  const expectedSecret = process.env.ADMIN_RESET_SECRET
  if (expectedSecret && adminSecret === expectedSecret) return

  throw new Error('Admin authorization required')
}

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
  const browserProfile = await ctx.db
    .query('browserProfiles')
    .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUserId))
    .first()

  if (browserProfile) {
    return {
      source: 'phone',
      browserProfileId: browserProfile._id,
      browserUseProfileId: browserProfile.browserUseProfileId,
    } satisfies BrowserProfileResolution
  }

  const defaultBrowserUseProfileId =
    process.env.DEFAULT_BROWSER_USE_PROFILE_ID ??
    process.env.BROWSER_USE_PROFILE_ID
  if (defaultBrowserUseProfileId) {
    return {
      source: 'default',
      browserUseProfileId: defaultBrowserUseProfileId,
    } satisfies BrowserProfileResolution
  }

  return null
}

const getConversationHistory = async (
  ctx: MutationCtx,
  phoneUserId: Id<'phoneUsers'>,
): Promise<ConversationMessage[]> => {
  const phoneUser = await ctx.db.get(phoneUserId)
  if (!phoneUser) return []

  const messages = await ctx.db
    .query('conversationMessages')
    .withIndex('by_phoneUserId_createdAt', (q) =>
      phoneUser.resetBefore
        ? q
            .eq('phoneUserId', phoneUserId)
            .gt('createdAt', phoneUser.resetBefore)
        : q.eq('phoneUserId', phoneUserId),
    )
    .order('desc')
    .take(conversationHistoryLimit)

  const orderedMessages = messages.reverse()
  const formattedMessages: ConversationMessage[] = []
  for (const message of orderedMessages) {
    const attachments = await getMessageAttachments(ctx, message._id)
    const formatted = await formatMessageInput(ctx, message.body, attachments)
    formattedMessages.push({
      role: message.direction,
      body: formatted.body,
      imageUrls:
        formatted.imageUrls.length > 0 ? formatted.imageUrls : undefined,
      createdAt: message.createdAt,
    })
  }

  return formattedMessages
}

const getMessageAttachments = async (
  ctx: MutationCtx,
  conversationMessageId: Id<'conversationMessages'>,
) => {
  return await ctx.db
    .query('conversationAttachments')
    .withIndex('by_conversationMessageId', (q) =>
      q.eq('conversationMessageId', conversationMessageId),
    )
    .collect()
}

function isImageAttachment(attachment: MessageAttachmentInput) {
  return /^(image\/(png|jpe?g|webp|gif))$/i.test(attachment.contentType ?? '')
}

const formatMessageInput = async (
  ctx: MutationCtx,
  body: string,
  attachments: MessageAttachmentInput[],
): Promise<FormattedMessageInput> => {
  const trimmedBody = body.trim()
  if (attachments.length === 0) return { body: trimmedBody, imageUrls: [] }

  const lines = [trimmedBody || '[no text]']
  const imageUrls: string[] = []
  lines.push('Attachments available to the agent via Convex file URLs:')
  for (const [index, attachment] of attachments.entries()) {
    const url = await ctx.storage.getUrl(attachment.storageId)
    if (url && isImageAttachment(attachment)) {
      imageUrls.push(url)
    }
    const details = [
      attachment.filename ? `name=${attachment.filename}` : null,
      attachment.contentType ? `contentType=${attachment.contentType}` : null,
      typeof attachment.size === 'number' ? `size=${attachment.size}` : null,
      attachment.sourceUrl ? `sourceUrl=${attachment.sourceUrl}` : null,
    ]
      .filter(Boolean)
      .join(', ')
    lines.push(
      `${index + 1}. convexStorageId=${attachment.storageId}; convexFileUrl=${
        url ?? '[unavailable]'
      }${details ? `; ${details}` : ''}`,
    )
  }
  return { body: lines.join('\n'), imageUrls }
}

const insertUserConversationMessage = async (
  ctx: MutationCtx,
  input: {
    phoneUserId: Id<'phoneUsers'>
    runId: Id<'agentRuns'>
    inboundWebhookId: string
    channel: 'sms' | 'mms' | 'imessage'
    body: string
    attachments: MessageAttachmentInput[]
    createdAt: number
    direction?: Extract<ConversationDirection, 'user' | 'external'>
    externalSource?: string
  },
) => {
  const conversationMessageId = await ctx.db.insert('conversationMessages', {
    phoneUserId: input.phoneUserId,
    runId: input.runId,
    inboundWebhookId: input.inboundWebhookId,
    direction: input.direction ?? 'user',
    externalSource: input.externalSource,
    channel: input.channel,
    body: input.body,
    attachmentCount: input.attachments.length,
    createdAt: input.createdAt,
  })

  for (const attachment of input.attachments) {
    await ctx.db.insert('conversationAttachments', {
      phoneUserId: input.phoneUserId,
      conversationMessageId,
      runId: input.runId,
      inboundWebhookId: input.inboundWebhookId,
      storageId: attachment.storageId,
      sourceUrl: attachment.sourceUrl,
      filename: attachment.filename,
      contentType: attachment.contentType,
      size: attachment.size,
      sha256: attachment.sha256,
      createdAt: input.createdAt,
    })
  }

  const formatted = await formatMessageInput(ctx, input.body, input.attachments)

  return {
    conversationMessageId,
    prompt: formatted.body,
    imageUrls: formatted.imageUrls,
  }
}

const getInputForRun = async (
  ctx: MutationCtx,
  runId: Id<'agentRuns'>,
): Promise<FormattedMessageInput> => {
  const message = await ctx.db
    .query('conversationMessages')
    .withIndex('by_runId', (q) => q.eq('runId', runId))
    .filter((q) =>
      q.or(
        q.eq(q.field('direction'), 'user'),
        q.eq(q.field('direction'), 'external'),
      ),
    )
    .order('desc')
    .first()
  if (!message) {
    const run = await ctx.db.get(runId)
    return { body: run?.prompt ?? '', imageUrls: [] }
  }

  const attachments = await getMessageAttachments(ctx, message._id)
  return await formatMessageInput(ctx, message.body, attachments)
}

const ensureSandboxAssignment = async (
  ctx: MutationCtx,
  phoneUserId: Id<'phoneUsers'>,
  timestamp: number,
) => {
  const existingAssignedSandbox = await ctx.db
    .query('agentSandboxes')
    .withIndex('by_phoneUserId', (q) => q.eq('phoneUserId', phoneUserId))
    .first()

  if (existingAssignedSandbox) {
    if (existingAssignedSandbox.poolRole !== 'assigned') {
      await ctx.db.patch(existingAssignedSandbox._id, {
        poolRole: 'assigned',
        assignedAt: existingAssignedSandbox.assignedAt ?? timestamp,
        updatedAt: timestamp,
      })
    }
    return existingAssignedSandbox.sandboxName
  }

  const reserveSandbox = await ctx.db
    .query('agentSandboxes')
    .withIndex('by_poolRole_and_status', (q) =>
      q.eq('poolRole', 'reserve').eq('status', 'ready'),
    )
    .first()

  if (!reserveSandbox) return undefined

  await ctx.db.patch(reserveSandbox._id, {
    phoneUserId,
    poolRole: 'assigned',
    assignedAt: timestamp,
    updatedAt: timestamp,
  })

  return reserveSandbox.sandboxName
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

  const sandboxName =
    nextRun.sandboxName ??
    (await ensureSandboxAssignment(ctx, phoneUserId, timestamp))
  if (sandboxName && sandboxName !== nextRun.sandboxName) {
    await ctx.db.patch(nextRun._id, {
      sandboxName,
      updatedAt: timestamp,
    })
  }

  const nextInput = await getInputForRun(ctx, nextRun._id)

  return {
    runId: nextRun._id,
    phoneNumber: phoneUser.phoneNumber,
    sandboxName,
    prompt: nextInput.body,
    imageUrls: nextInput.imageUrls,
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
    attachments: v.optional(v.array(attachmentInput)),
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

    const sandboxName = browserProfile
      ? await ensureSandboxAssignment(ctx, phoneUser._id, timestamp)
      : undefined

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId:
        browserProfile?.source === 'phone'
          ? browserProfile.browserProfileId
          : undefined,
      sandboxName,
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

    const message = await insertUserConversationMessage(ctx, {
      phoneUserId: phoneUser._id,
      runId,
      inboundWebhookId: args.webhookId,
      channel: args.channel,
      body: args.prompt,
      attachments: args.attachments ?? [],
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
        : browserProfile.source === 'default'
          ? 'Queued remote Codex run with default Browser Use profile'
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
      sandboxName,
      prompt: message.prompt,
      imageUrls: message.imageUrls,
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
    attachments: v.optional(v.array(attachmentInput)),
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
      const message = await insertUserConversationMessage(ctx, {
        phoneUserId: phoneUser._id,
        runId,
        inboundWebhookId: args.webhookId,
        channel: args.channel,
        body: args.prompt,
        attachments: args.attachments ?? [],
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
        prompt: message.prompt,
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
      const message = await insertUserConversationMessage(ctx, {
        phoneUserId: phoneUser._id,
        runId: activeRun._id,
        inboundWebhookId: args.webhookId,
        channel: args.channel,
        body: args.prompt,
        attachments: args.attachments ?? [],
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
        sandboxName: activeRun.sandboxName,
        prompt: message.prompt,
        imageUrls: message.imageUrls,
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

    const sandboxName = await ensureSandboxAssignment(
      ctx,
      phoneUser._id,
      timestamp,
    )

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId:
        browserProfile.source === 'phone'
          ? browserProfile.browserProfileId
          : undefined,
      sandboxName,
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

    const message = await insertUserConversationMessage(ctx, {
      phoneUserId: phoneUser._id,
      runId,
      inboundWebhookId: args.webhookId,
      channel: args.channel,
      body: args.prompt,
      attachments: args.attachments ?? [],
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
      browserProfile.source === 'default'
        ? 'Queued app-server turn with default Browser Use profile'
        : phoneUser.codexThreadId
          ? 'Queued app-server follow-up turn'
          : 'Queued first app-server turn',
    )

    return {
      kind: 'start',
      runId,
      phoneUserId: phoneUser._id,
      phoneNumber: phoneUser.phoneNumber,
      sandboxName,
      prompt: message.prompt,
      imageUrls: message.imageUrls,
      browserUseProfileId: browserProfile.browserUseProfileId,
      codexThreadId: phoneUser.codexThreadId,
      conversationHistory: await getConversationHistory(ctx, phoneUser._id),
    }
  },
})

export const enqueueExternalNotificationForAppServer = mutation({
  args: {
    notificationId: v.string(),
    phoneNumber: v.string(),
    message: v.string(),
    source: v.optional(v.string()),
    channel: v.optional(messageChannel),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<AppServerEnqueueResult> => {
    const duplicateMessage = await ctx.db
      .query('conversationMessages')
      .withIndex('by_inboundWebhookId', (q) =>
        q.eq('inboundWebhookId', args.notificationId),
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

    const timestamp = now()
    const phoneNumber = normalizePhoneNumber(args.phoneNumber)
    const source = args.source?.trim() || 'external agent'
    const externalBody = `[External notification from ${source}]\n${args.message.trim()}`

    let phoneUser = await ctx.db
      .query('phoneUsers')
      .withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', phoneNumber))
      .first()

    if (!phoneUser) {
      const phoneUserId = await ctx.db.insert('phoneUsers', {
        phoneNumber,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      phoneUser = (await ctx.db.get(phoneUserId))!
    } else {
      await ctx.db.patch(phoneUser._id, { updatedAt: timestamp })
    }

    const latestMessage = await ctx.db
      .query('conversationMessages')
      .withIndex('by_phoneUserId_createdAt', (q) =>
        q.eq('phoneUserId', phoneUser._id),
      )
      .order('desc')
      .first()
    const channel = args.channel ?? latestMessage?.channel ?? 'sms'

    const browserProfile = await getBrowserProfile(ctx, phoneUser._id)
    if (!browserProfile) {
      const runId = await ctx.db.insert('agentRuns', {
        phoneUserId: phoneUser._id,
        inboundWebhookId: args.notificationId,
        agentPhoneConversationId: args.conversationId,
        channel,
        prompt: externalBody,
        runtime: 'app_server',
        status: 'needs_profile',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      const message = await insertUserConversationMessage(ctx, {
        phoneUserId: phoneUser._id,
        runId,
        inboundWebhookId: args.notificationId,
        channel,
        body: externalBody,
        attachments: [],
        createdAt: timestamp,
        direction: 'external',
        externalSource: source,
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
        prompt: message.prompt,
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
      const message = await insertUserConversationMessage(ctx, {
        phoneUserId: phoneUser._id,
        runId: activeRun._id,
        inboundWebhookId: args.notificationId,
        channel,
        body: externalBody,
        attachments: [],
        createdAt: timestamp,
        direction: 'external',
        externalSource: source,
      })
      await addRunEvent(
        ctx,
        activeRun._id,
        'external_steer_requested',
        `Steering active turn with external notification ${args.notificationId}`,
      )

      return {
        kind: 'steer',
        runId: activeRun._id,
        phoneUserId: phoneUser._id,
        phoneNumber: phoneUser.phoneNumber,
        sandboxName: activeRun.sandboxName,
        prompt: message.prompt,
        imageUrls: message.imageUrls,
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

    const sandboxName = await ensureSandboxAssignment(
      ctx,
      phoneUser._id,
      timestamp,
    )

    const runId = await ctx.db.insert('agentRuns', {
      phoneUserId: phoneUser._id,
      browserProfileId:
        browserProfile.source === 'phone'
          ? browserProfile.browserProfileId
          : undefined,
      sandboxName,
      inboundWebhookId: args.notificationId,
      agentPhoneConversationId: args.conversationId,
      channel,
      prompt: externalBody,
      runtime: 'app_server',
      codexThreadId: phoneUser.codexThreadId,
      status: 'queued',
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    const message = await insertUserConversationMessage(ctx, {
      phoneUserId: phoneUser._id,
      runId,
      inboundWebhookId: args.notificationId,
      channel,
      body: externalBody,
      attachments: [],
      createdAt: timestamp,
      direction: 'external',
      externalSource: source,
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
        ? 'Queued app-server follow-up turn from external notification'
        : 'Queued first app-server turn from external notification',
    )

    return {
      kind: 'start',
      runId,
      phoneUserId: phoneUser._id,
      phoneNumber: phoneUser.phoneNumber,
      sandboxName,
      prompt: message.prompt,
      imageUrls: message.imageUrls,
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
        phoneUserId: run.phoneUserId,
        image: args.image,
        region: args.region,
        poolRole: 'assigned',
        status: 'creating',
        lastError: undefined,
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        assignedAt: existingSandbox.assignedAt ?? timestamp,
        updatedAt: timestamp,
      })
    } else {
      await ctx.db.insert('agentSandboxes', {
        phoneUserId: run.phoneUserId,
        sandboxName: args.sandboxName,
        image: args.image,
        region: args.region,
        poolRole: 'assigned',
        status: 'creating',
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        assignedAt: timestamp,
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
        phoneUserId: run.phoneUserId,
        image: args.image,
        region: args.region,
        poolRole: 'assigned',
        status: 'creating',
        lastError: undefined,
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        assignedAt: existingSandbox.assignedAt ?? timestamp,
        updatedAt: timestamp,
      })
    } else {
      await ctx.db.insert('agentSandboxes', {
        phoneUserId: run.phoneUserId,
        sandboxName: args.sandboxName,
        image: args.image,
        region: args.region,
        poolRole: 'assigned',
        status: 'creating',
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        assignedAt: timestamp,
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
    agentReplyText: v.optional(v.string()),
    agentReplyItemId: v.optional(v.string()),
    agentReplyMediaUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run || run.status !== 'running') return null

    const timestamp = now()
    const agentReplyText = args.agentReplyText?.trim()
    const agentReplyMediaUrls = args.agentReplyMediaUrls ?? []
    const hasReply = Boolean(agentReplyText) || agentReplyMediaUrls.length > 0
    await ctx.db.patch(args.runId, {
      status: 'completed',
      processStatus: args.processStatus ?? 'idle',
      agentReplyText: agentReplyText || undefined,
      agentReplyItemId: args.agentReplyItemId,
      agentReplyMediaUrls:
        agentReplyMediaUrls.length > 0 ? agentReplyMediaUrls : undefined,
      replyDeliveryStatus: hasReply ? 'pending' : undefined,
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

    if (hasReply) {
      await ctx.db.insert('conversationMessages', {
        phoneUserId: run.phoneUserId,
        runId: args.runId,
        direction: 'agent',
        channel: run.channel,
        body: agentReplyText || '',
        attachmentCount: agentReplyMediaUrls.length,
        createdAt: timestamp,
      })
    }

    await addRunEvent(
      ctx,
      args.runId,
      'completed',
      hasReply
        ? 'Codex app-server turn completed; outbound reply pending'
        : 'Codex app-server turn completed',
    )

    if (!hasReply) return null

    return {
      runId: args.runId,
      phoneNumber: phoneUser?.phoneNumber,
      replyText: agentReplyText || '',
      mediaUrls: agentReplyMediaUrls,
      channel: run.channel,
    }
  },
})

export const markAgentPhoneReplySent = mutation({
  args: {
    runId: v.id('agentRuns'),
    agentPhoneMessageId: v.optional(v.string()),
    agentPhoneMessageIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return

    const timestamp = now()
    await ctx.db.patch(args.runId, {
      replyDeliveryStatus: 'sent',
      replyDeliveryError: undefined,
      agentPhoneMessageId: args.agentPhoneMessageId,
      agentPhoneMessageIds: args.agentPhoneMessageIds,
      replySentAt: timestamp,
      updatedAt: timestamp,
    })
    await addRunEvent(ctx, args.runId, 'outbound_sent', 'Sent AgentPhone reply')
  },
})

export const markAgentPhoneReplyFailed = mutation({
  args: {
    runId: v.id('agentRuns'),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId)
    if (!run) return

    await ctx.db.patch(args.runId, {
      replyDeliveryStatus: 'failed',
      replyDeliveryError: args.error,
      updatedAt: now(),
    })
    await addRunEvent(ctx, args.runId, 'outbound_failed', args.error)
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

export const planSandboxReserveCreation = internalMutation({
  args: {
    target: v.number(),
    image: v.string(),
    region: v.optional(v.string()),
    candidateSandboxNames: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const target = Math.min(Math.max(Math.trunc(args.target), 0), 10)
    if (target === 0) return []

    const [readyReserves, creatingReserves] = await Promise.all([
      ctx.db
        .query('agentSandboxes')
        .withIndex('by_poolRole_and_status', (q) =>
          q.eq('poolRole', 'reserve').eq('status', 'ready'),
        )
        .take(target),
      ctx.db
        .query('agentSandboxes')
        .withIndex('by_poolRole_and_status', (q) =>
          q.eq('poolRole', 'reserve').eq('status', 'creating'),
        )
        .take(target),
    ])

    const needed = target - readyReserves.length - creatingReserves.length
    if (needed <= 0) return []

    const timestamp = now()
    const sandboxNames: string[] = []
    for (const sandboxName of args.candidateSandboxNames.slice(0, needed)) {
      await ctx.db.insert('agentSandboxes', {
        sandboxName,
        image: args.image,
        region: args.region,
        poolRole: 'reserve',
        status: 'creating',
        lastStartedAt: timestamp,
        lastSeenAt: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      sandboxNames.push(sandboxName)
    }

    return sandboxNames
  },
})

export const markReserveSandboxReady = internalMutation({
  args: {
    sandboxName: v.string(),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db
      .query('agentSandboxes')
      .withIndex('by_sandboxName', (q) => q.eq('sandboxName', args.sandboxName))
      .first()

    if (!sandbox || sandbox.poolRole !== 'reserve') return

    await ctx.db.patch(sandbox._id, {
      status: 'ready',
      lastError: undefined,
      lastSeenAt: now(),
      updatedAt: now(),
    })
  },
})

export const markReserveSandboxError = internalMutation({
  args: {
    sandboxName: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const sandbox = await ctx.db
      .query('agentSandboxes')
      .withIndex('by_sandboxName', (q) => q.eq('sandboxName', args.sandboxName))
      .first()

    if (!sandbox || sandbox.poolRole !== 'reserve') return

    const timestamp = now()
    await ctx.db.patch(sandbox._id, {
      status: 'error',
      lastError: args.error,
      lastSeenAt: timestamp,
      updatedAt: timestamp,
    })
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

export const resetPhoneUserState = mutation({
  args: {
    phoneNumber: v.string(),
    adminSecret: v.optional(v.string()),
    reason: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireAdmin(ctx, args.adminSecret)

    const phoneNumber = normalizePhoneNumber(args.phoneNumber)
    const phoneUser = await ctx.db
      .query('phoneUsers')
      .withIndex('by_phoneNumber', (q) => q.eq('phoneNumber', phoneNumber))
      .first()

    if (!phoneUser) {
      return {
        ok: false,
        phoneNumber,
        reset: false,
        reason: 'phone_user_not_found',
      }
    }

    const timestamp = now()
    let interruptedRunId: Id<'agentRuns'> | undefined
    if (phoneUser.activeRunId) {
      const activeRun = await ctx.db.get(phoneUser.activeRunId)
      if (activeRun && activeRunStatuses.has(activeRun.status)) {
        await ctx.db.patch(activeRun._id, {
          status: 'interrupted',
          completedAt: timestamp,
          updatedAt: timestamp,
        })
        await addRunEvent(
          ctx,
          activeRun._id,
          'interrupted',
          'Interrupted by admin state reset',
        )
        interruptedRunId = activeRun._id
      }
    }

    await ctx.db.patch(phoneUser._id, {
      activeRunId: undefined,
      codexThreadId: undefined,
      resetBefore: timestamp,
      updatedAt: timestamp,
    })

    await ctx.db.insert('conversationMessages', {
      phoneUserId: phoneUser._id,
      direction: 'system',
      body: args.reason
        ? `State reset by admin: ${args.reason}`
        : 'State reset by admin',
      createdAt: timestamp,
    })

    return {
      ok: true,
      phoneNumber,
      phoneUserId: phoneUser._id,
      resetBefore: timestamp,
      interruptedRunId,
    }
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
