'use node'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'

const allowedMessageChannels = ['sms', 'mms', 'imessage'] as const

type AgentPhoneMessageChannel = (typeof allowedMessageChannels)[number]

type AgentPhoneWebhookPayload = {
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
    direction?: string
    receivedAt?: string
  }
}

type StartRemoteCodexRunInput = {
  runId: string
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
}

type WebhookActionResult = {
  status: number
  body: Record<string, unknown>
}

type EnqueueAgentPhoneMessageResult =
  | {
      kind: 'duplicate'
      runId: string
      status: string
    }
  | {
      kind: 'needs_profile'
      runId: string
      phoneUserId: string
      phoneNumber: string
      prompt: string
      browserUseProfileId?: string
      activeRunId?: string
    }
  | {
      kind: 'queued_waiting'
      runId: string
      phoneUserId: string
      phoneNumber: string
      prompt: string
      browserUseProfileId?: string
      activeRunId?: string
    }
  | {
      kind: 'queued'
      runId: string
      phoneUserId: string
      phoneNumber: string
      prompt: string
      browserUseProfileId?: string
      activeRunId?: string
    }

const enqueueAgentPhoneMessageRef = makeFunctionReference(
  'agentRuntime:enqueueAgentPhoneMessage',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    webhookId: string
    phoneNumber: string
    channel: AgentPhoneMessageChannel
    prompt: string
    conversationId?: string
  },
  EnqueueAgentPhoneMessageResult
>

const markRunFailedRef = makeFunctionReference(
  'agentRuntime:markRunFailed',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName?: string
    error: string
  },
  null
>

const markRunStartingRef = makeFunctionReference(
  'agentRuntime:markRunStarting',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName: string
    image: string
    region?: string
  },
  null
>

const markRunRemoteStartedRef = makeFunctionReference(
  'agentRuntime:markRunRemoteStarted',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName: string
    processName: string
    processStatus: string
  },
  null
>

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

const json = (
  status: number,
  body: Record<string, unknown>,
): WebhookActionResult => ({
  status,
  body,
})

function verifyAgentPhoneWebhook(input: {
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

function normalizeAgentPhoneNumber(phoneNumber: string | undefined) {
  if (!phoneNumber) return null

  const normalized = phoneNumber.trim().replace(/[^\d+]/g, '')
  if (!/^\+[1-9]\d{1,14}$/.test(normalized)) return null

  return normalized
}

function isSupportedMessageWebhook(
  payload: AgentPhoneWebhookPayload,
): payload is AgentPhoneWebhookPayload & {
  event: 'agent.message'
  channel: AgentPhoneMessageChannel
  data: NonNullable<AgentPhoneWebhookPayload['data']> & {
    from: string
    message: string
  }
} {
  return (
    payload.event === 'agent.message' &&
    allowedMessageChannels.includes(
      payload.channel as AgentPhoneMessageChannel,
    ) &&
    typeof payload.data?.from === 'string' &&
    typeof payload.data.message === 'string'
  )
}

function sandboxNameForPhone(phoneNumber: string) {
  const digest = createHash('sha256').update(phoneNumber).digest('hex')
  return `gavel-user-${digest.slice(0, 24)}`
}

async function startRemoteCodexRun(input: StartRemoteCodexRunInput) {
  const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
  if (!image) throw new Error('BLAXEL_CODEX_BROWSERCODE_IMAGE is not set')
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set')
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is not set')
  }

  const region = process.env.BL_REGION
  const sandboxName = sandboxNameForPhone(input.phoneNumber)
  const runSlug = createHash('sha256')
    .update(input.runId)
    .digest('hex')
    .slice(0, 16)
  const sandbox = await SandboxInstance.createIfNotExists({
    name: sandboxName,
    image,
    memory: 8192,
    region,
    labels: {
      app: 'gavel',
      runtime: 'codex-browsercode',
    },
  })

  await sandbox.wait({ maxWait: 120_000, interval: 2_000 })

  const promptPath = `/workspace/gavel-runs/${runSlug}/prompt.md`
  await sandbox.fs.write(promptPath, buildRunPrompt(input))

  const processName = `codex-${runSlug}`
  const codexCommand = [
    'codex exec',
    '--json',
    '--cd /workspace/gavel-agent',
    '--sandbox danger-full-access',
    '--dangerously-bypass-approvals-and-sandbox',
    `- < ${shellQuote(promptPath)}`,
  ].join(' ')

  const processResult = await sandbox.process.exec({
    name: processName,
    command: `sh -lc ${shellQuote(codexCommand)}`,
    workingDir: '/workspace/gavel-agent',
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    env: {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY,
      BROWSER_USE_PROFILE_ID: input.browserUseProfileId,
    },
  })

  return {
    sandboxName,
    image,
    region,
    processName: processResult.name ?? processName,
    processStatus: processResult.status ?? 'running',
  }
}

function buildRunPrompt(input: StartRemoteCodexRunInput) {
  return `You are Gavel, an agent that helps the user sell stuff hands-off.

The user is messaging from ${input.phoneNumber}.

Use the BrowserCode browser_execute MCP tool when browser work is needed.
Use Browser Use cloud with the provided BROWSER_USE_PROFILE_ID.
Do not send marketplace messages or accept offers without final user confirmation.

User message:
${input.prompt}
`
}

export const handleAgentPhoneWebhook = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.union(v.string(), v.null()),
    timestamp: v.union(v.string(), v.null()),
    webhookId: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<WebhookActionResult> => {
    if (
      !verifyAgentPhoneWebhook({
        rawBody: args.rawBody,
        signature: args.signature,
        timestamp: args.timestamp,
        secret: process.env.AGENTPHONE_WEBHOOK_SECRET,
      })
    ) {
      return json(401, { ok: false, error: 'invalid signature' })
    }

    if (!args.webhookId) {
      return json(400, { ok: false, error: 'missing webhook id' })
    }

    let payload: AgentPhoneWebhookPayload
    try {
      payload = JSON.parse(args.rawBody) as AgentPhoneWebhookPayload
    } catch {
      return json(400, { ok: false, error: 'invalid json' })
    }

    if (!isSupportedMessageWebhook(payload)) {
      return json(200, { ok: true, ignored: true })
    }

    const phoneNumber = normalizeAgentPhoneNumber(payload.data.from)
    if (!phoneNumber) {
      return json(400, { ok: false, error: 'invalid sender phone number' })
    }

    const enqueued = await ctx.runMutation(enqueueAgentPhoneMessageRef, {
      webhookId: args.webhookId,
      phoneNumber,
      channel: payload.channel,
      prompt: payload.data.message,
      conversationId: payload.data.conversationId,
    })

    if (enqueued.kind === 'duplicate') {
      return json(200, {
        ok: true,
        duplicate: true,
        runId: enqueued.runId,
      })
    }

    if (enqueued.kind === 'needs_profile') {
      return json(200, {
        ok: true,
        status: 'needs_profile',
        runId: enqueued.runId,
      })
    }

    if (enqueued.kind === 'queued_waiting') {
      return json(200, {
        ok: true,
        status: 'queued',
        runId: enqueued.runId,
        activeRunId: enqueued.activeRunId,
      })
    }

    const sandboxName = sandboxNameForPhone(phoneNumber)
    const browserUseProfileId = enqueued.browserUseProfileId
    if (!browserUseProfileId) {
      await ctx.runMutation(markRunFailedRef, {
        runId: enqueued.runId,
        sandboxName,
        error: 'Browser Use profile is missing for this phone number',
      })
      return json(500, {
        ok: false,
        error: 'browser profile is not configured',
      })
    }

    const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
    if (!image) {
      await ctx.runMutation(markRunFailedRef, {
        runId: enqueued.runId,
        sandboxName,
        error: 'BLAXEL_CODEX_BROWSERCODE_IMAGE is not set',
      })
      return json(500, { ok: false, error: 'runtime image is not configured' })
    }

    try {
      await ctx.runMutation(markRunStartingRef, {
        runId: enqueued.runId,
        sandboxName,
        image,
        region: process.env.BL_REGION,
      })
      const remoteRun = await startRemoteCodexRun({
        runId: enqueued.runId,
        phoneNumber,
        prompt: enqueued.prompt,
        browserUseProfileId,
      })
      await ctx.runMutation(markRunRemoteStartedRef, {
        runId: enqueued.runId,
        sandboxName: remoteRun.sandboxName,
        processName: remoteRun.processName,
        processStatus: remoteRun.processStatus,
      })

      return json(200, {
        ok: true,
        status: 'running',
        runId: enqueued.runId,
        sandboxName: remoteRun.sandboxName,
        processName: remoteRun.processName,
      })
    } catch (err) {
      await ctx.runMutation(markRunFailedRef, {
        runId: enqueued.runId,
        sandboxName,
        error: err instanceof Error ? err.message : String(err),
      })

      return json(500, { ok: false, error: 'failed to start remote codex run' })
    }
  },
})
