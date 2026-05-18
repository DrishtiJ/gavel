'use node'

import {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual,
} from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'
import { gavelAgentInstructions } from './gavelAgentInstructions'

const allowedMessageChannels = ['sms', 'mms', 'imessage'] as const

const reserveSandboxNamePrefix = 'gavel-reserve'

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
    mediaUrls?: string[]
    attachments?: AgentPhoneMediaItem[]
    media?: AgentPhoneMediaItem[]
    direction?: string
    receivedAt?: string
  }
}

type AgentPhoneMediaItem = {
  url?: string | null
  mediaUrl?: string | null
  downloadUrl?: string | null
  contentType?: string | null
  mimeType?: string | null
  filename?: string | null
  fileName?: string | null
  name?: string | null
}

type StoredWebhookAttachment = {
  storageId: string
  sourceUrl?: string
  filename?: string
  contentType?: string
  size?: number
  sha256?: string
}

type StartRemoteCodexRunInput = {
  runId: string
  phoneNumber: string
  sandboxName?: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type WebhookActionResult = {
  status: number
  body: Record<string, unknown>
}

type ExternalAgentNotificationPayload = {
  phoneNumber?: string
  recipientPhoneNumber?: string
  message?: string
  source?: string
  channel?: string
  conversationId?: string
  notificationId?: string
  idempotencyKey?: string
}

type RunProgressEvent = {
  type: string
  message: string
}

type ConversationMessage = {
  role: 'user' | 'agent' | 'system' | 'external'
  body: string
  createdAt: number
}

type StartableQueuedRun = {
  runId: string
  phoneNumber: string
  sandboxName?: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type InterruptedRun = {
  runId: string
  sandboxName?: string
  processName?: string
}

type AppServerRunInput = {
  runId: string
  phoneNumber: string
  sandboxName?: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type AppServerSteerInput = AppServerRunInput & {
  codexThreadId: string
  codexTurnId: string
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
      sandboxName?: string
      prompt: string
      browserUseProfileId?: string
      codexThreadId?: string
      conversationHistory: ConversationMessage[]
      interruptedRun?: InterruptedRun
    }
  | {
      kind: 'queued'
      runId: string
      phoneUserId: string
      phoneNumber: string
      sandboxName?: string
      prompt: string
      browserUseProfileId?: string
      codexThreadId?: string
      conversationHistory: ConversationMessage[]
      interruptedRun?: InterruptedRun
    }

type EnqueueAppServerAgentPhoneMessageResult =
  | {
      kind: 'duplicate'
      runId?: string
      status?: string
    }
  | {
      kind: 'needs_profile'
      runId: string
      phoneUserId: string
      phoneNumber: string
      sandboxName?: string
      prompt: string
    }
  | {
      kind: 'start'
      runId: string
      phoneUserId: string
      phoneNumber: string
      sandboxName?: string
      prompt: string
      browserUseProfileId: string
      codexThreadId?: string
      conversationHistory: ConversationMessage[]
    }
  | {
      kind: 'steer'
      runId: string
      phoneUserId: string
      phoneNumber: string
      sandboxName?: string
      prompt: string
      browserUseProfileId: string
      codexThreadId: string
      codexTurnId: string
      conversationHistory: ConversationMessage[]
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
    attachments?: StoredWebhookAttachment[]
  },
  EnqueueAgentPhoneMessageResult
>

const enqueueAgentPhoneMessageForAppServerRef = makeFunctionReference(
  'agentRuntime:enqueueAgentPhoneMessageForAppServer',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    webhookId: string
    phoneNumber: string
    channel: AgentPhoneMessageChannel
    prompt: string
    conversationId?: string
    attachments?: StoredWebhookAttachment[]
  },
  EnqueueAppServerAgentPhoneMessageResult
>

const enqueueExternalNotificationForAppServerRef = makeFunctionReference(
  'agentRuntime:enqueueExternalNotificationForAppServer',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    notificationId: string
    phoneNumber: string
    message: string
    source?: string
    channel?: AgentPhoneMessageChannel
    conversationId?: string
  },
  EnqueueAppServerAgentPhoneMessageResult
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
  StartableQueuedRun | null
>

const markAppServerRunStartingRef = makeFunctionReference(
  'agentRuntime:markAppServerRunStarting',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName: string
    image: string
    region?: string
    processName: string
  },
  null
>

const markAppServerTurnStartedRef = makeFunctionReference(
  'agentRuntime:markAppServerTurnStarted',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName: string
    processName: string
    codexThreadId: string
    codexTurnId: string
  },
  null
>

const markAppServerSteerAcceptedRef = makeFunctionReference(
  'agentRuntime:markAppServerSteerAccepted',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    codexTurnId: string
  },
  null
>

const markAppServerTurnCompletedRef = makeFunctionReference(
  'agentRuntime:markAppServerTurnCompleted',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    processStatus?: string
    agentReplyText?: string
    agentReplyItemId?: string
    agentReplyMediaUrls?: string[]
  },
  {
    runId: string
    phoneNumber?: string
    replyText: string
    mediaUrls?: string[]
    channel: AgentPhoneMessageChannel
  } | null
>

const markAgentPhoneReplySentRef = makeFunctionReference(
  'agentRuntime:markAgentPhoneReplySent',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    agentPhoneMessageId?: string
    agentPhoneMessageIds?: string[]
  },
  null
>

const markAgentPhoneReplyFailedRef = makeFunctionReference(
  'agentRuntime:markAgentPhoneReplyFailed',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
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
    codexThreadId?: string
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

const appendRunProgressRef = makeFunctionReference(
  'agentRuntime:appendRunProgress',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    processStatus?: string
    processLogOffset: number
    codexThreadId?: string
    events: RunProgressEvent[]
  },
  null
>

const markRunCompletedRef = makeFunctionReference(
  'agentRuntime:markRunCompleted',
) as unknown as FunctionReference<
  'mutation',
  'public',
  {
    runId: string
    sandboxName: string
    processName: string
    processStatus: string
    processLogOffset: number
  },
  StartableQueuedRun | null
>

const monitorRemoteCodexRunRef = makeFunctionReference(
  'agentphoneWebhook:monitorRemoteCodexRun',
) as unknown as FunctionReference<
  'action',
  'internal',
  {
    runId: string
    sandboxName: string
    processName: string
    logOffset: number
    attempt: number
  },
  null
>

const monitorAppServerTurnRef = makeFunctionReference(
  'agentphoneWebhook:monitorAppServerTurn',
) as unknown as FunctionReference<
  'action',
  'internal',
  {
    runId: string
    sandboxName: string
    threadId: string
    turnId: string
    attempt: number
  },
  null
>

const maintainSandboxReservePoolRef = makeFunctionReference(
  'agentphoneWebhook:maintainSandboxReservePool',
) as unknown as FunctionReference<
  'action',
  'internal',
  Record<string, never>,
  null
>

const planSandboxReserveCreationRef = makeFunctionReference(
  'agentRuntime:planSandboxReserveCreation',
) as unknown as FunctionReference<
  'mutation',
  'internal',
  {
    target: number
    image: string
    region?: string
    candidateSandboxNames: string[]
  },
  string[]
>

const markReserveSandboxReadyRef = makeFunctionReference(
  'agentRuntime:markReserveSandboxReady',
) as unknown as FunctionReference<
  'mutation',
  'internal',
  {
    sandboxName: string
  },
  null
>

const markReserveSandboxErrorRef = makeFunctionReference(
  'agentRuntime:markReserveSandboxError',
) as unknown as FunctionReference<
  'mutation',
  'internal',
  {
    sandboxName: string
    error: string
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

function bearerToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]?.trim() ?? null
}

function verifyExternalAgentSecret(secret: string | null) {
  const expected =
    process.env.AGENT_NOTIFY_SECRET ?? process.env.ADMIN_RESET_SECRET
  if (!expected || !secret) return false

  const actualBuffer = Buffer.from(secret)
  const expectedBuffer = Buffer.from(expected)
  if (actualBuffer.length !== expectedBuffer.length) return false

  return timingSafeEqual(actualBuffer, expectedBuffer)
}

function parseOptionalChannel(channel: string | undefined) {
  return allowedMessageChannels.find((value) => value === channel)
}

function firstString(...values: Array<string | null | undefined>) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}

function extractMediaItems(payload: AgentPhoneWebhookPayload) {
  const items: AgentPhoneMediaItem[] = []
  const data = payload.data
  if (!data) return items

  if (typeof data.mediaUrl === 'string' && data.mediaUrl.trim()) {
    items.push({ url: data.mediaUrl })
  }
  for (const mediaUrl of data.mediaUrls ?? []) {
    if (typeof mediaUrl === 'string' && mediaUrl.trim()) {
      items.push({ url: mediaUrl })
    }
  }
  for (const attachment of data.attachments ?? []) {
    items.push(attachment)
  }
  for (const media of data.media ?? []) {
    items.push(media)
  }

  const seen = new Set<string>()
  return items.filter((item) => {
    const url = firstString(item.url, item.mediaUrl, item.downloadUrl)
    if (!url || seen.has(url)) return false
    seen.add(url)
    return true
  })
}

function filenameFromHeadersOrUrl(response: Response, url: string) {
  const disposition = response.headers.get('content-disposition')
  const headerMatch = disposition?.match(
    /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i,
  )
  if (headerMatch?.[1]) return decodeURIComponent(headerMatch[1])

  try {
    const pathname = new URL(url).pathname
    const filename = pathname.split('/').filter(Boolean).at(-1)
    return filename ? decodeURIComponent(filename) : undefined
  } catch {
    return undefined
  }
}

async function fetchMedia(url: string) {
  let response = await fetch(url)
  if (
    (response.status === 401 || response.status === 403) &&
    process.env.AGENTPHONE_API_KEY
  ) {
    response = await fetch(url, {
      headers: { authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}` },
    })
  }
  if (!response.ok) {
    throw new Error(`failed to fetch attachment ${response.status}`)
  }
  return response
}

async function storeWebhookAttachments(
  ctx: ActionCtx,
  payload: AgentPhoneWebhookPayload,
) {
  const stored: StoredWebhookAttachment[] = []
  for (const item of extractMediaItems(payload)) {
    const sourceUrl = firstString(item.url, item.mediaUrl, item.downloadUrl)
    if (!sourceUrl) continue

    const response = await fetchMedia(sourceUrl)
    const arrayBuffer = await response.arrayBuffer()
    const bytes = Buffer.from(arrayBuffer)
    const contentType =
      firstString(item.contentType, item.mimeType) ??
      response.headers.get('content-type') ??
      'application/octet-stream'
    const filename =
      firstString(item.filename, item.fileName, item.name) ??
      filenameFromHeadersOrUrl(response, sourceUrl)
    const storageId = await ctx.storage.store(
      new Blob([arrayBuffer], { type: contentType }),
    )

    stored.push({
      storageId,
      sourceUrl,
      filename,
      contentType,
      size: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    })
  }
  return stored
}

function isSupportedMessageWebhook(
  payload: AgentPhoneWebhookPayload,
): payload is AgentPhoneWebhookPayload & {
  event: 'agent.message'
  channel: AgentPhoneMessageChannel
  data: NonNullable<AgentPhoneWebhookPayload['data']> & {
    from: string
    message?: string
  }
} {
  const mediaItems = extractMediaItems(payload)
  return (
    payload.event === 'agent.message' &&
    allowedMessageChannels.includes(
      payload.channel as AgentPhoneMessageChannel,
    ) &&
    typeof payload.data?.from === 'string' &&
    (typeof payload.data.message === 'string' || mediaItems.length > 0)
  )
}

function sandboxNameForPhone(phoneNumber: string) {
  const digest = createHash('sha256').update(phoneNumber).digest('hex')
  return `gavel-user-${digest.slice(0, 24)}`
}

function reservePoolTarget() {
  const configured = Number.parseInt(
    process.env.BLAXEL_SANDBOX_RESERVE_TARGET ?? '2',
    10,
  )
  if (!Number.isFinite(configured) || configured < 0) return 2
  return Math.min(configured, 10)
}

async function scheduleReservePoolRefill(ctx: ActionCtx) {
  await ctx.scheduler.runAfter(0, maintainSandboxReservePoolRef, {})
}

const terminalProcessStatuses = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
])

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function truncateEventMessage(message: string) {
  return message.length > 1_500 ? `${message.slice(0, 1_497)}...` : message
}

function eventFromCodexLogLine(line: string): RunProgressEvent {
  const trimmed = line.trim()
  if (!trimmed) return { type: 'codex_log', message: '' }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const type =
      typeof parsed.type === 'string'
        ? parsed.type
        : typeof parsed.event === 'string'
          ? parsed.event
          : 'json'
    const message =
      typeof parsed.message === 'string'
        ? parsed.message
        : typeof parsed.msg === 'string'
          ? parsed.msg
          : typeof parsed.summary === 'string'
            ? parsed.summary
            : trimmed

    return {
      type: `codex_${type}`.replaceAll(/[^a-zA-Z0-9_:-]/g, '_'),
      message: truncateEventMessage(message),
    }
  } catch {
    return {
      type: 'codex_log',
      message: truncateEventMessage(trimmed),
    }
  }
}

function eventsFromNewLogs(logs: string, offset: number) {
  const safeOffset = offset > logs.length ? 0 : offset
  const nextOffset = logs.length
  let codexThreadId: string | undefined
  const events = logs
    .slice(safeOffset)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>
        if (
          parsed.type === 'thread.started' &&
          typeof parsed.thread_id === 'string'
        ) {
          codexThreadId = parsed.thread_id
        }
      } catch {
        // Non-JSON stderr lines are still captured as regular log events.
      }

      return eventFromCodexLogLine(line)
    })

  return { nextOffset, events, codexThreadId }
}

const appServerPort = 4500
const appServerProcessName = 'codex-app-server'
const appServerBridgePath = '/workspace/gavel-runtime/app-server-bridge.mjs'
const gavelAgentInstructionsPath = '/workspace/gavel-agent/AGENTS.md'

function appServerTurnKeepAliveProcessName(runId: string) {
  const digest = createHash('sha256').update(runId).digest('hex').slice(0, 16)
  return `app-server-turn-keepalive-${digest}`
}

async function installGavelAgentInstructions(sandbox: SandboxInstance) {
  await sandbox.fs.write(gavelAgentInstructionsPath, gavelAgentInstructions)
}

type AppServerBridgeStartResult = {
  kind: 'start'
  threadId: string
  turnId: string
}

type AppServerBridgeSteerResult = {
  kind: 'steer'
  turnId: string
}

type AppServerBridgeReadResult = {
  kind: 'read'
  threadStatusType?: string
  turnStatus?: string
  agentReplyItemId?: string
  agentReplyText?: string
}

type AppServerBridgeResult =
  | AppServerBridgeStartResult
  | AppServerBridgeSteerResult
  | AppServerBridgeReadResult

const appServerBridgeScript = String.raw`
const input = JSON.parse(Buffer.from(process.env.GAVEL_APP_SERVER_INPUT_B64, "base64").toString("utf8"));

let nextId = 1;
const pending = new Map();
const notifications = [];

function fail(message) {
  console.error(JSON.stringify({ error: message }));
  process.exit(1);
}

function request(ws, method, params) {
  const id = nextId++;
  const payload = { id, method };
  if (params !== undefined) payload.params = params;
  ws.send(JSON.stringify(payload));
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
}

function notify(ws, method, params) {
  const payload = { method };
  if (params !== undefined) payload.params = params;
  ws.send(JSON.stringify(payload));
}

function textInput(text) {
  return [{ type: "text", text }];
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return undefined;
}

function getAgentReply(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const agentMessages = items.filter((item) => item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim());
  const finalMessage = [...agentMessages].reverse().find((item) => item.phase === "final_answer");
  const message = finalMessage ?? agentMessages.at(-1);
  if (!message) return {};
  return {
    agentReplyItemId: firstString(message.id),
    agentReplyText: message.text.trim()
  };
}

const ws = new WebSocket(input.url);

const opened = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("app-server websocket open timeout")), 10000);
  ws.addEventListener("open", () => {
    clearTimeout(timer);
    resolve();
  }, { once: true });
  ws.addEventListener("error", () => reject(new Error("app-server websocket error")), { once: true });
});

ws.addEventListener("message", (event) => {
  let message;
  try {
    message = JSON.parse(event.data);
  } catch {
    return;
  }

  if (typeof message.id === "number" && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message ?? JSON.stringify(message.error)));
    else resolve(message.result);
    return;
  }

  if (message.method) notifications.push(message);
});

try {
  await opened;
  await request(ws, "initialize", {
    clientInfo: {
      name: "gavel_agentphone",
      title: "Gavel AgentPhone",
      version: "0.1.0"
    },
    capabilities: { experimentalApi: true }
  });
  notify(ws, "initialized", {});

  if (input.mode === "start") {
    let threadId = input.threadId;
    if (threadId) {
      const resumed = await request(ws, "thread/resume", {
        threadId,
        cwd: input.cwd
      });
      threadId = firstString(resumed?.thread?.id, resumed?.id, threadId);
    } else {
      const started = await request(ws, "thread/start", {
        cwd: input.cwd
      });
      threadId = firstString(started?.thread?.id, started?.id);
    }

    if (!threadId) fail("app-server did not return a thread id");

    const turnStarted = await request(ws, "turn/start", {
      threadId,
      input: textInput(input.prompt),
      cwd: input.cwd,
      approvalPolicy: "never",
      sandboxPolicy: { type: "dangerFullAccess" }
    });
    const turnId = firstString(turnStarted?.turn?.id, turnStarted?.id);
    if (!turnId) fail("app-server did not return a turn id");

    console.log(JSON.stringify({ kind: "start", threadId, turnId }));
  } else if (input.mode === "steer") {
    const steered = await request(ws, "turn/steer", {
      threadId: input.threadId,
      expectedTurnId: input.turnId,
      input: textInput(input.prompt)
    });
    const turnId = firstString(steered?.turnId, input.turnId);
    console.log(JSON.stringify({ kind: "steer", turnId }));
  } else if (input.mode === "read") {
    const read = await request(ws, "thread/read", {
      threadId: input.threadId,
      includeTurns: true
    });
    const thread = read?.thread ?? read;
    const turns = Array.isArray(thread?.turns) ? thread.turns : [];
    const turn = turns.find((candidate) => candidate?.id === input.turnId) ?? turns.at(-1);
    const agentReply = getAgentReply(turn);
    console.log(JSON.stringify({
      kind: "read",
      threadStatusType: thread?.status?.type,
      turnStatus: turn?.status,
      ...agentReply
    }));
  } else {
    fail("unknown bridge mode");
  }

  ws.close();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
`

function codexRuntimeEnv(browserUseProfileId?: string) {
  const env: Record<string, string> = {}
  if (browserUseProfileId) {
    env.BROWSER_USE_PROFILE_ID = browserUseProfileId
  }
  if (process.env.BROWSER_USE_API_KEY) {
    env.BROWSER_USE_API_KEY = process.env.BROWSER_USE_API_KEY
  }
  if (process.env.OPENAI_API_KEY) {
    env.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  }
  if (process.env.CODEX_ACCESS_TOKEN) {
    env.CODEX_ACCESS_TOKEN = process.env.CODEX_ACCESS_TOKEN
  }
  if (process.env.CODEX_AUTH_JSON_B64) {
    env.CODEX_AUTH_JSON_B64 = process.env.CODEX_AUTH_JSON_B64
  }
  return env
}

async function ensureCodexAppServer(input: {
  sandbox: SandboxInstance
  browserUseProfileId: string
}) {
  await installGavelAgentInstructions(input.sandbox)

  let needsStart = true
  try {
    const existing = await input.sandbox.process.get(appServerProcessName)
    needsStart = existing.status !== 'running'
  } catch {
    needsStart = true
  }

  if (needsStart) {
    const command = [
      'if [ -n "${CODEX_AUTH_JSON_B64:-}" ]; then',
      'mkdir -p "$HOME/.codex" &&',
      'printf %s "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json" &&',
      'chmod 600 "$HOME/.codex/auth.json";',
      'fi;',
      `codex app-server --listen ws://127.0.0.1:${appServerPort}`,
    ].join(' ')

    await input.sandbox.process.exec({
      name: appServerProcessName,
      command: `sh -lc ${shellQuote(command)}`,
      workingDir: '/workspace/gavel-agent',
      waitForCompletion: false,
      timeout: 0,
      env: codexRuntimeEnv(input.browserUseProfileId),
    })
  }

  await input.sandbox.process.exec({
    name: `app-server-ready-${Date.now()}`,
    command: `sh -lc ${shellQuote(
      `for i in $(seq 1 60); do curl -fsS http://127.0.0.1:${appServerPort}/readyz >/dev/null && exit 0; sleep 1; done; exit 1`,
    )}`,
    workingDir: '/workspace/gavel-agent',
    waitForCompletion: true,
    timeout: 70_000,
  })
}

async function runAppServerBridge(
  sandbox: SandboxInstance,
  input: Record<string, unknown>,
) {
  await sandbox.fs.write(appServerBridgePath, appServerBridgeScript)

  const processName = `app-server-bridge-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`
  const encodedInput = Buffer.from(JSON.stringify(input)).toString('base64')
  const result = (await sandbox.process.exec({
    name: processName,
    command: `node ${shellQuote(appServerBridgePath)}`,
    workingDir: '/workspace/gavel-agent',
    waitForCompletion: true,
    timeout: 60_000,
    env: {
      GAVEL_APP_SERVER_INPUT_B64: encodedInput,
    },
  })) as { status?: string; logs?: string }

  const logs =
    result.logs ?? (await sandbox.process.logs(processName, 'all')).toString()
  const jsonLine = logs
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'))
    .at(-1)

  if (!jsonLine) {
    throw new Error(`app-server bridge returned no JSON output: ${logs}`)
  }

  const parsed = JSON.parse(jsonLine) as AppServerBridgeResult & {
    error?: string
  }
  if (parsed.error) throw new Error(parsed.error)
  return parsed
}

async function startAppServerTurnKeepAlive(input: {
  sandbox: SandboxInstance
  runId: string
}) {
  const processName = appServerTurnKeepAliveProcessName(input.runId)

  try {
    const existing = await input.sandbox.process.get(processName)
    if (existing.status === 'running') return processName
  } catch {
    // Start a fresh per-turn keep-alive below.
  }

  await input.sandbox.process.exec({
    name: processName,
    command: 'sleep infinity',
    workingDir: '/workspace/gavel-agent',
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
  })

  return processName
}

async function stopAppServerTurnKeepAlive(input: {
  sandbox: SandboxInstance
  runId: string
}) {
  try {
    await input.sandbox.process.kill(
      appServerTurnKeepAliveProcessName(input.runId),
    )
  } catch {
    // The keep-alive may already have exited or been cleaned up.
  }
}

function parseOutboundReply(text: string | undefined) {
  let body = text?.trim() ?? ''
  const mediaUrls: string[] = []

  body = body.replace(
    /!\[[^\]]*]\((https?:\/\/[^)\s]+)\)/g,
    (_match, url: string) => {
      mediaUrls.push(url)
      return ''
    },
  )

  body = body.replace(
    /^\s*\[media:\s*(https?:\/\/[^\]\s]+)\]\s*$/gim,
    (_match, url: string) => {
      mediaUrls.push(url)
      return ''
    },
  )

  return {
    body: body
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, index, lines) => line || lines[index - 1])
      .join('\n')
      .trim(),
    mediaUrls: [...new Set(mediaUrls)],
  }
}

async function sendAgentPhoneReply(input: {
  toNumber: string
  body: string
  mediaUrl?: string
}) {
  const apiKey = process.env.AGENTPHONE_API_KEY
  const agentId = process.env.AGENTPHONE_AGENT_ID
  if (!apiKey) throw new Error('AGENTPHONE_API_KEY is not set')
  if (!agentId) throw new Error('AGENTPHONE_AGENT_ID is not set')

  const requestBody: {
    agent_id: string
    to_number: string
    body: string
    media_url?: string
    number_id?: string
  } = {
    agent_id: agentId,
    to_number: input.toNumber,
    body: input.body,
  }
  if (input.mediaUrl) {
    requestBody.media_url = input.mediaUrl
  }
  if (process.env.AGENTPHONE_NUMBER_ID) {
    requestBody.number_id = process.env.AGENTPHONE_NUMBER_ID
  }

  const response = await fetch('https://api.agentphone.ai/v1/messages', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(requestBody),
  })

  const responseText = await response.text()
  let responseBody: unknown = null
  try {
    responseBody = responseText ? JSON.parse(responseText) : null
  } catch {
    responseBody = responseText
  }

  if (!response.ok) {
    throw new Error(
      `AgentPhone send failed with ${response.status}: ${responseText}`,
    )
  }

  const data =
    responseBody && typeof responseBody === 'object' && 'data' in responseBody
      ? (responseBody as { data?: unknown }).data
      : responseBody
  const messageId =
    data && typeof data === 'object' && 'id' in data
      ? (data as { id?: unknown }).id
      : null

  return {
    agentPhoneMessageId: typeof messageId === 'string' ? messageId : undefined,
  }
}

async function ensureAppServerSandbox(input: AppServerRunInput) {
  const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
  if (!image) throw new Error('BLAXEL_CODEX_BROWSERCODE_IMAGE is not set')
  if (
    !process.env.OPENAI_API_KEY &&
    !process.env.CODEX_ACCESS_TOKEN &&
    !process.env.CODEX_AUTH_JSON_B64
  ) {
    throw new Error(
      'OPENAI_API_KEY, CODEX_ACCESS_TOKEN, or CODEX_AUTH_JSON_B64 must be set',
    )
  }
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is not set')
  }

  const sandboxName =
    input.sandboxName ?? sandboxNameForPhone(input.phoneNumber)
  const region = process.env.BL_REGION
  const sandbox = await SandboxInstance.createIfNotExists({
    name: sandboxName,
    image,
    memory: 8192,
    region,
    labels: {
      app: 'gavel',
      runtime: 'codex-app-server',
    },
  })

  await sandbox.wait({ maxWait: 120_000, interval: 2_000 })
  await ensureCodexAppServer({
    sandbox,
    browserUseProfileId: input.browserUseProfileId,
  })

  return { sandbox, sandboxName, image, region }
}

async function startAppServerTurn(ctx: ActionCtx, input: AppServerRunInput) {
  const sandboxName =
    input.sandboxName ?? sandboxNameForPhone(input.phoneNumber)
  const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
  if (!image) {
    await ctx.runMutation(markRunFailedRef, {
      runId: input.runId,
      sandboxName,
      error: 'BLAXEL_CODEX_BROWSERCODE_IMAGE is not set',
    })
    throw new Error('runtime image is not configured')
  }

  await ctx.runMutation(markAppServerRunStartingRef, {
    runId: input.runId,
    sandboxName,
    image,
    region: process.env.BL_REGION,
    processName: appServerProcessName,
  })

  const runtime = await ensureAppServerSandbox(input)
  await startAppServerTurnKeepAlive({
    sandbox: runtime.sandbox,
    runId: input.runId,
  })

  let bridgeResult: AppServerBridgeResult
  try {
    bridgeResult = await runAppServerBridge(runtime.sandbox, {
      mode: 'start',
      url: `ws://127.0.0.1:${appServerPort}`,
      cwd: '/workspace/gavel-agent',
      threadId: input.codexThreadId,
      prompt: buildRunPrompt(input),
    })

    if (bridgeResult.kind !== 'start') {
      throw new Error('app-server bridge did not start a turn')
    }
  } catch (err) {
    await stopAppServerTurnKeepAlive({
      sandbox: runtime.sandbox,
      runId: input.runId,
    })
    throw err
  }

  await ctx.runMutation(markAppServerTurnStartedRef, {
    runId: input.runId,
    sandboxName: runtime.sandboxName,
    processName: appServerProcessName,
    codexThreadId: bridgeResult.threadId,
    codexTurnId: bridgeResult.turnId,
  })

  await ctx.scheduler.runAfter(2_000, monitorAppServerTurnRef, {
    runId: input.runId,
    sandboxName: runtime.sandboxName,
    threadId: bridgeResult.threadId,
    turnId: bridgeResult.turnId,
    attempt: 1,
  })

  return {
    sandboxName: runtime.sandboxName,
    processName: appServerProcessName,
    threadId: bridgeResult.threadId,
    turnId: bridgeResult.turnId,
  }
}

async function steerAppServerTurn(ctx: ActionCtx, input: AppServerSteerInput) {
  const runtime = await ensureAppServerSandbox(input)
  await startAppServerTurnKeepAlive({
    sandbox: runtime.sandbox,
    runId: input.runId,
  })
  const bridgeResult = await runAppServerBridge(runtime.sandbox, {
    mode: 'steer',
    url: `ws://127.0.0.1:${appServerPort}`,
    threadId: input.codexThreadId,
    turnId: input.codexTurnId,
    prompt: input.prompt,
  })

  if (bridgeResult.kind !== 'steer') {
    throw new Error('app-server bridge did not steer the turn')
  }

  await ctx.runMutation(markAppServerSteerAcceptedRef, {
    runId: input.runId,
    codexTurnId: bridgeResult.turnId,
  })

  return {
    sandboxName: runtime.sandboxName,
    processName: appServerProcessName,
    threadId: input.codexThreadId,
    turnId: bridgeResult.turnId,
  }
}

async function startRemoteCodexRun(input: StartRemoteCodexRunInput) {
  const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
  if (!image) throw new Error('BLAXEL_CODEX_BROWSERCODE_IMAGE is not set')
  if (
    !process.env.OPENAI_API_KEY &&
    !process.env.CODEX_ACCESS_TOKEN &&
    !process.env.CODEX_AUTH_JSON_B64
  ) {
    throw new Error(
      'OPENAI_API_KEY, CODEX_ACCESS_TOKEN, or CODEX_AUTH_JSON_B64 must be set',
    )
  }
  if (!process.env.BROWSER_USE_API_KEY) {
    throw new Error('BROWSER_USE_API_KEY is not set')
  }

  const region = process.env.BL_REGION
  const sandboxName =
    input.sandboxName ?? sandboxNameForPhone(input.phoneNumber)
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

  await installGavelAgentInstructions(sandbox)

  const promptPath = `/workspace/gavel-runs/${runSlug}/prompt.md`
  await sandbox.fs.write(promptPath, buildRunPrompt(input))

  const processName = `codex-${runSlug}`
  const processEnv: Record<string, string> = {
    BROWSER_USE_API_KEY: process.env.BROWSER_USE_API_KEY,
    BROWSER_USE_PROFILE_ID: input.browserUseProfileId,
  }
  if (process.env.OPENAI_API_KEY) {
    processEnv.OPENAI_API_KEY = process.env.OPENAI_API_KEY
  }
  if (process.env.CODEX_ACCESS_TOKEN) {
    processEnv.CODEX_ACCESS_TOKEN = process.env.CODEX_ACCESS_TOKEN
  }
  if (process.env.CODEX_AUTH_JSON_B64) {
    processEnv.CODEX_AUTH_JSON_B64 = process.env.CODEX_AUTH_JSON_B64
  }

  const codexCommandPrefix = input.codexThreadId
    ? [
        'codex exec resume',
        '--json',
        '--dangerously-bypass-approvals-and-sandbox',
        '--skip-git-repo-check',
        shellQuote(input.codexThreadId),
      ].join(' ')
    : [
        'codex exec',
        '--json',
        '--cd /workspace/gavel-agent',
        '--sandbox danger-full-access',
        '--dangerously-bypass-approvals-and-sandbox',
        '--skip-git-repo-check',
      ].join(' ')

  const codexCommand = [
    'if [ -n "${CODEX_AUTH_JSON_B64:-}" ]; then',
    'mkdir -p "$HOME/.codex" &&',
    'printf %s "$CODEX_AUTH_JSON_B64" | base64 -d > "$HOME/.codex/auth.json" &&',
    'chmod 600 "$HOME/.codex/auth.json";',
    'fi;',
    `${codexCommandPrefix} - < ${shellQuote(promptPath)}`,
  ].join(' ')

  const processResult = await sandbox.process.exec({
    name: processName,
    command: `sh -lc ${shellQuote(codexCommand)}`,
    workingDir: '/workspace/gavel-agent',
    waitForCompletion: false,
    keepAlive: true,
    timeout: 0,
    env: processEnv,
  })

  return {
    sandboxName,
    image,
    region,
    processName: processResult.name ?? processName,
    processStatus: processResult.status ?? 'running',
  }
}

async function startQueuedRemoteCodexRun(
  ctx: ActionCtx,
  input: StartableQueuedRun,
) {
  const sandboxName =
    input.sandboxName ?? sandboxNameForPhone(input.phoneNumber)
  const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
  if (!image) {
    await ctx.runMutation(markRunFailedRef, {
      runId: input.runId,
      sandboxName,
      error: 'BLAXEL_CODEX_BROWSERCODE_IMAGE is not set',
    })
    throw new Error('runtime image is not configured')
  }

  await ctx.runMutation(markRunStartingRef, {
    runId: input.runId,
    sandboxName,
    image,
    region: process.env.BL_REGION,
    codexThreadId: input.codexThreadId,
  })
  const remoteRun = await startRemoteCodexRun(input)
  await ctx.runMutation(markRunRemoteStartedRef, {
    runId: input.runId,
    sandboxName: remoteRun.sandboxName,
    processName: remoteRun.processName,
    processStatus: remoteRun.processStatus,
  })
  await ctx.scheduler.runAfter(0, monitorRemoteCodexRunRef, {
    runId: input.runId,
    sandboxName: remoteRun.sandboxName,
    processName: remoteRun.processName,
    logOffset: 0,
    attempt: 1,
  })

  return remoteRun
}

async function killInterruptedRemoteProcess(interruptedRun?: InterruptedRun) {
  if (!interruptedRun?.sandboxName || !interruptedRun.processName) return

  try {
    const sandbox = await SandboxInstance.get(interruptedRun.sandboxName)
    await sandbox.process.kill(interruptedRun.processName)
  } catch {
    // The old process may already have exited; the new steering run should proceed.
  }
}

async function startQueuedRemoteCodexRunSafely(
  ctx: ActionCtx,
  input: StartableQueuedRun,
) {
  try {
    await startQueuedRemoteCodexRun(ctx, input)
    await scheduleReservePoolRefill(ctx)
  } catch (err) {
    await ctx.runMutation(markRunFailedRef, {
      runId: input.runId,
      sandboxName: input.sandboxName ?? sandboxNameForPhone(input.phoneNumber),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export const maintainSandboxReservePool = internalAction({
  args: {},
  handler: async (ctx) => {
    const target = reservePoolTarget()
    if (target === 0) return null

    const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
    if (!image) return null

    const region = process.env.BL_REGION
    const sandboxNames = await ctx.runMutation(planSandboxReserveCreationRef, {
      target,
      image,
      region,
      candidateSandboxNames: Array.from(
        { length: target },
        () => `${reserveSandboxNamePrefix}-${randomUUID()}`,
      ),
    })

    for (const sandboxName of sandboxNames) {
      try {
        const sandbox = await SandboxInstance.createIfNotExists({
          name: sandboxName,
          image,
          memory: 8192,
          region,
          labels: {
            app: 'gavel',
            runtime: 'codex-reserve',
            pool: 'reserve',
          },
        })
        await sandbox.wait({ maxWait: 120_000, interval: 2_000 })
        await ctx.runMutation(markReserveSandboxReadyRef, { sandboxName })
      } catch (err) {
        await ctx.runMutation(markReserveSandboxErrorRef, {
          sandboxName,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return null
  },
})

function buildRunPrompt(input: StartRemoteCodexRunInput) {
  const history = input.conversationHistory
    .map((message) => {
      const timestamp = new Date(message.createdAt).toISOString()
      return `- ${timestamp} ${message.role}: ${message.body}`
    })
    .join('\n')

  return `Runtime context for this Gavel phone conversation:

- User phone number: ${input.phoneNumber}
- Conversation continuity: this is one continuing conversation for this phone number. Use the same listing state, browser profile, and marketplace context from earlier turns.
- Browser Use: BROWSER_USE_PROFILE_ID is configured in the runtime environment.
- Browser live preview URL: not provided for this turn.
- Attachments: any available image/file URLs are included inline in the conversation history or latest user message as Convex file URLs with metadata.
- Outbound media: if you need to send media, follow the AGENTS.md media marker format in your final answer.

Conversation history:
${history || '- No previous messages.'}

Latest message or notification:
${input.prompt}
`
}

export const handleExternalAgentNotification = internalAction({
  args: {
    rawBody: v.string(),
    authorization: v.union(v.string(), v.null()),
    secret: v.union(v.string(), v.null()),
    idempotencyKey: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args): Promise<WebhookActionResult> => {
    const providedSecret = args.secret ?? bearerToken(args.authorization)
    if (!verifyExternalAgentSecret(providedSecret)) {
      return json(401, { ok: false, error: 'invalid secret' })
    }

    let payload: ExternalAgentNotificationPayload
    try {
      payload = JSON.parse(args.rawBody) as ExternalAgentNotificationPayload
    } catch {
      return json(400, { ok: false, error: 'invalid json' })
    }

    const phoneNumber = normalizeAgentPhoneNumber(
      payload.phoneNumber ?? payload.recipientPhoneNumber,
    )
    if (!phoneNumber) {
      return json(400, {
        ok: false,
        error: 'phoneNumber must be in E.164 format',
      })
    }

    const message = payload.message?.trim()
    if (!message) {
      return json(400, { ok: false, error: 'message is required' })
    }

    const notificationId =
      payload.notificationId ??
      payload.idempotencyKey ??
      args.idempotencyKey ??
      `external:${randomUUID()}`

    const enqueued = await ctx.runMutation(
      enqueueExternalNotificationForAppServerRef,
      {
        notificationId,
        phoneNumber,
        message,
        source: payload.source ?? 'phone agent',
        channel: parseOptionalChannel(payload.channel),
        conversationId: payload.conversationId,
      },
    )

    if (enqueued.kind === 'duplicate') {
      return json(200, {
        ok: true,
        duplicate: true,
        runId: enqueued.runId,
        status: enqueued.status,
      })
    }

    if (enqueued.kind === 'needs_profile') {
      return json(200, {
        ok: true,
        status: 'needs_profile',
        runId: enqueued.runId,
      })
    }

    await scheduleReservePoolRefill(ctx)

    try {
      if (enqueued.kind === 'steer') {
        const steered = await steerAppServerTurn(ctx, {
          runId: enqueued.runId,
          phoneNumber,
          sandboxName: enqueued.sandboxName,
          prompt: enqueued.prompt,
          browserUseProfileId: enqueued.browserUseProfileId,
          codexThreadId: enqueued.codexThreadId,
          codexTurnId: enqueued.codexTurnId,
          conversationHistory: enqueued.conversationHistory,
        })

        return json(200, {
          ok: true,
          status: 'steered',
          runId: enqueued.runId,
          sandboxName: steered.sandboxName,
          threadId: steered.threadId,
          turnId: steered.turnId,
        })
      }

      const started = await startAppServerTurn(ctx, {
        runId: enqueued.runId,
        phoneNumber,
        sandboxName: enqueued.sandboxName,
        prompt: enqueued.prompt,
        browserUseProfileId: enqueued.browserUseProfileId,
        codexThreadId: enqueued.codexThreadId,
        conversationHistory: enqueued.conversationHistory,
      })

      return json(200, {
        ok: true,
        status: 'running',
        runtime: 'app_server',
        runId: enqueued.runId,
        sandboxName: started.sandboxName,
        processName: started.processName,
        threadId: started.threadId,
        turnId: started.turnId,
      })
    } catch (err) {
      await ctx.runMutation(markRunFailedRef, {
        runId: enqueued.runId,
        sandboxName: enqueued.sandboxName ?? sandboxNameForPhone(phoneNumber),
        error: err instanceof Error ? err.message : String(err),
      })

      return json(500, {
        ok: false,
        error: 'failed to process external notification',
      })
    }
  },
})

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

    const conversationId = payload.data.conversationId ?? undefined
    let attachments: StoredWebhookAttachment[]
    try {
      attachments = await storeWebhookAttachments(ctx, payload)
    } catch (err) {
      return json(502, {
        ok: false,
        error: err instanceof Error ? err.message : 'failed to store media',
      })
    }
    const prompt = payload.data.message ?? ''

    if (process.env.CODEX_RUNTIME !== 'exec') {
      const enqueued = await ctx.runMutation(
        enqueueAgentPhoneMessageForAppServerRef,
        {
          webhookId: args.webhookId,
          phoneNumber,
          channel: payload.channel,
          prompt,
          conversationId,
          attachments,
        },
      )

      if (enqueued.kind === 'duplicate') {
        return json(200, {
          ok: true,
          duplicate: true,
          runId: enqueued.runId,
          status: enqueued.status,
        })
      }

      if (enqueued.kind === 'needs_profile') {
        return json(200, {
          ok: true,
          status: 'needs_profile',
          runId: enqueued.runId,
        })
      }

      await scheduleReservePoolRefill(ctx)

      try {
        if (enqueued.kind === 'steer') {
          const steered = await steerAppServerTurn(ctx, {
            runId: enqueued.runId,
            phoneNumber,
            sandboxName: enqueued.sandboxName,
            prompt: enqueued.prompt,
            browserUseProfileId: enqueued.browserUseProfileId,
            codexThreadId: enqueued.codexThreadId,
            codexTurnId: enqueued.codexTurnId,
            conversationHistory: enqueued.conversationHistory,
          })

          return json(200, {
            ok: true,
            status: 'steered',
            runId: enqueued.runId,
            sandboxName: steered.sandboxName,
            threadId: steered.threadId,
            turnId: steered.turnId,
          })
        }

        const started = await startAppServerTurn(ctx, {
          runId: enqueued.runId,
          phoneNumber,
          sandboxName: enqueued.sandboxName,
          prompt: enqueued.prompt,
          browserUseProfileId: enqueued.browserUseProfileId,
          codexThreadId: enqueued.codexThreadId,
          conversationHistory: enqueued.conversationHistory,
        })

        return json(200, {
          ok: true,
          status: 'running',
          runtime: 'app_server',
          runId: enqueued.runId,
          sandboxName: started.sandboxName,
          processName: started.processName,
          threadId: started.threadId,
          turnId: started.turnId,
        })
      } catch (err) {
        await ctx.runMutation(markRunFailedRef, {
          runId: enqueued.runId,
          sandboxName: enqueued.sandboxName ?? sandboxNameForPhone(phoneNumber),
          error: err instanceof Error ? err.message : String(err),
        })

        return json(500, {
          ok: false,
          error: 'failed to process app-server turn',
        })
      }
    }

    const enqueued = await ctx.runMutation(enqueueAgentPhoneMessageRef, {
      webhookId: args.webhookId,
      phoneNumber,
      channel: payload.channel,
      prompt,
      conversationId,
      attachments,
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

    await scheduleReservePoolRefill(ctx)

    const sandboxName = enqueued.sandboxName ?? sandboxNameForPhone(phoneNumber)
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

    try {
      await killInterruptedRemoteProcess(enqueued.interruptedRun)
      const remoteRun = await startQueuedRemoteCodexRun(ctx, {
        runId: enqueued.runId,
        phoneNumber,
        sandboxName,
        prompt: enqueued.prompt,
        browserUseProfileId,
        codexThreadId: enqueued.codexThreadId,
        conversationHistory: enqueued.conversationHistory,
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

export const monitorRemoteCodexRun = internalAction({
  args: {
    runId: v.string(),
    sandboxName: v.string(),
    processName: v.string(),
    logOffset: v.number(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const sandbox = await SandboxInstance.get(args.sandboxName)
      const [processResult, logs] = await Promise.all([
        sandbox.process.get(args.processName),
        sandbox.process.logs(args.processName, 'all'),
      ])
      const processStatus = processResult.status ?? 'running'
      const { nextOffset, events, codexThreadId } = eventsFromNewLogs(
        logs,
        args.logOffset,
      )

      if (events.length > 0 || nextOffset !== args.logOffset || codexThreadId) {
        await ctx.runMutation(appendRunProgressRef, {
          runId: args.runId,
          processStatus,
          processLogOffset: nextOffset,
          codexThreadId,
          events,
        })
      }

      if (processStatus === 'completed') {
        const nextRun = await ctx.runMutation(markRunCompletedRef, {
          runId: args.runId,
          sandboxName: args.sandboxName,
          processName: args.processName,
          processStatus,
          processLogOffset: nextOffset,
        })
        if (nextRun) {
          await startQueuedRemoteCodexRunSafely(ctx, nextRun)
        }
        return null
      }

      if (terminalProcessStatuses.has(processStatus)) {
        const nextRun = await ctx.runMutation(markRunFailedRef, {
          runId: args.runId,
          sandboxName: args.sandboxName,
          error: `Remote Codex process ended with status ${processStatus}`,
        })
        if (nextRun) {
          await startQueuedRemoteCodexRunSafely(ctx, nextRun)
        }
        return null
      }

      await ctx.scheduler.runAfter(2_000, monitorRemoteCodexRunRef, {
        ...args,
        logOffset: nextOffset,
        attempt: 1,
      })
      return null
    } catch (err) {
      if (args.attempt < 30) {
        await sleep(1_000)
        await ctx.scheduler.runAfter(5_000, monitorRemoteCodexRunRef, {
          ...args,
          attempt: args.attempt + 1,
        })
        return null
      }

      const nextRun = await ctx.runMutation(markRunFailedRef, {
        runId: args.runId,
        sandboxName: args.sandboxName,
        error: err instanceof Error ? err.message : String(err),
      })
      if (nextRun) {
        await startQueuedRemoteCodexRunSafely(ctx, nextRun)
      }
      return null
    }
  },
})

export const monitorAppServerTurn = internalAction({
  args: {
    runId: v.string(),
    sandboxName: v.string(),
    threadId: v.string(),
    turnId: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    try {
      const sandbox = await SandboxInstance.get(args.sandboxName)
      const bridgeResult = await runAppServerBridge(sandbox, {
        mode: 'read',
        url: `ws://127.0.0.1:${appServerPort}`,
        threadId: args.threadId,
        turnId: args.turnId,
      })

      if (bridgeResult.kind !== 'read') {
        throw new Error('app-server bridge did not read thread status')
      }

      const isComplete =
        bridgeResult.threadStatusType === 'idle' ||
        bridgeResult.turnStatus === 'completed' ||
        bridgeResult.turnStatus === 'failed' ||
        bridgeResult.turnStatus === 'interrupted'

      if (isComplete) {
        const parsedReply = parseOutboundReply(bridgeResult.agentReplyText)
        const outboundReply = await ctx.runMutation(
          markAppServerTurnCompletedRef,
          {
            runId: args.runId,
            processStatus:
              bridgeResult.threadStatusType ?? bridgeResult.turnStatus,
            agentReplyText: parsedReply.body,
            agentReplyItemId: bridgeResult.agentReplyItemId,
            agentReplyMediaUrls: parsedReply.mediaUrls,
          },
        )

        await stopAppServerTurnKeepAlive({
          sandbox,
          runId: args.runId,
        })

        if (outboundReply) {
          if (!outboundReply.phoneNumber) {
            await ctx.runMutation(markAgentPhoneReplyFailedRef, {
              runId: outboundReply.runId,
              error: 'Phone number is missing for outbound reply',
            })
            return null
          }

          try {
            const messageIds: string[] = []
            const mediaUrls =
              outboundReply.channel === 'imessage'
                ? (outboundReply.mediaUrls ?? [])
                : []
            const fallbackMediaUrls =
              outboundReply.channel === 'imessage'
                ? []
                : (outboundReply.mediaUrls ?? [])
            const body = [outboundReply.replyText, ...fallbackMediaUrls]
              .filter(Boolean)
              .join('\n')
              .trim()

            if (body || mediaUrls.length === 0) {
              const sent = await sendAgentPhoneReply({
                toNumber: outboundReply.phoneNumber,
                body,
                mediaUrl: mediaUrls[0],
              })
              if (sent.agentPhoneMessageId) {
                messageIds.push(sent.agentPhoneMessageId)
              }
            }

            for (const mediaUrl of mediaUrls.slice(body ? 1 : 0)) {
              const sent = await sendAgentPhoneReply({
                toNumber: outboundReply.phoneNumber,
                body: '',
                mediaUrl,
              })
              if (sent.agentPhoneMessageId) {
                messageIds.push(sent.agentPhoneMessageId)
              }
            }

            await ctx.runMutation(markAgentPhoneReplySentRef, {
              runId: outboundReply.runId,
              agentPhoneMessageId: messageIds[0],
              agentPhoneMessageIds: messageIds,
            })
          } catch (err) {
            await ctx.runMutation(markAgentPhoneReplyFailedRef, {
              runId: outboundReply.runId,
              error: err instanceof Error ? err.message : String(err),
            })
          }
        }

        return null
      }

      await ctx.scheduler.runAfter(2_000, monitorAppServerTurnRef, {
        ...args,
        attempt: 1,
      })
      return null
    } catch (err) {
      if (args.attempt < 30) {
        await sleep(1_000)
        await ctx.scheduler.runAfter(5_000, monitorAppServerTurnRef, {
          ...args,
          attempt: args.attempt + 1,
        })
        return null
      }

      await ctx.runMutation(markRunFailedRef, {
        runId: args.runId,
        sandboxName: args.sandboxName,
        error: err instanceof Error ? err.message : String(err),
      })
      try {
        const sandbox = await SandboxInstance.get(args.sandboxName)
        await stopAppServerTurnKeepAlive({
          sandbox,
          runId: args.runId,
        })
      } catch {
        // The sandbox may already be unavailable after repeated monitor errors.
      }
      return null
    }
  },
})
