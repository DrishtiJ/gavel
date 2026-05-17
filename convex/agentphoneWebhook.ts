'use node'

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { v } from 'convex/values'
import { internalAction } from './_generated/server'
import type { ActionCtx } from './_generated/server'

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
  codexThreadId?: string
  conversationHistory: ConversationMessage[]
}

type WebhookActionResult = {
  status: number
  body: Record<string, unknown>
}

type RunProgressEvent = {
  type: string
  message: string
}

type ConversationMessage = {
  role: 'user' | 'agent' | 'system'
  body: string
  createdAt: number
}

type StartableQueuedRun = {
  runId: string
  phoneNumber: string
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
      prompt: string
    }
  | {
      kind: 'start'
      runId: string
      phoneUserId: string
      phoneNumber: string
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
        cwd: input.cwd,
        sandbox: "danger-full-access"
      });
      threadId = firstString(resumed?.thread?.id, resumed?.id, threadId);
    } else {
      const started = await request(ws, "thread/start", {
        cwd: input.cwd,
        sandbox: "danger-full-access"
      });
      threadId = firstString(started?.thread?.id, started?.id);
    }

    if (!threadId) fail("app-server did not return a thread id");

    const turnStarted = await request(ws, "turn/start", {
      threadId,
      input: textInput(input.prompt),
      cwd: input.cwd,
      approvalPolicy: "never",
      sandboxPolicy: "danger-full-access"
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
    console.log(JSON.stringify({
      kind: "read",
      threadStatusType: thread?.status?.type,
      turnStatus: turn?.status
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
      keepAlive: true,
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

  const sandboxName = sandboxNameForPhone(input.phoneNumber)
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
  const sandboxName = sandboxNameForPhone(input.phoneNumber)
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
  const bridgeResult = await runAppServerBridge(runtime.sandbox, {
    mode: 'start',
    url: `ws://127.0.0.1:${appServerPort}`,
    cwd: '/workspace/gavel-agent',
    threadId: input.codexThreadId,
    prompt: buildRunPrompt(input),
  })

  if (bridgeResult.kind !== 'start') {
    throw new Error('app-server bridge did not start a turn')
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
  const sandboxName = sandboxNameForPhone(input.phoneNumber)
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
  } catch (err) {
    await ctx.runMutation(markRunFailedRef, {
      runId: input.runId,
      sandboxName: sandboxNameForPhone(input.phoneNumber),
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function buildRunPrompt(input: StartRemoteCodexRunInput) {
  const history = input.conversationHistory
    .map((message) => {
      const timestamp = new Date(message.createdAt).toISOString()
      return `- ${timestamp} ${message.role}: ${message.body}`
    })
    .join('\n')

  return `You are Gavel, an agent that helps the user sell stuff hands-off.

The user is messaging from ${input.phoneNumber}.
This is one continuing conversation for this phone number. Keep using the same context, listing state, browser profile, and marketplace work from earlier messages.

Use the BrowserCode browser_execute MCP tool when browser work is needed.
Use Browser Use cloud with the provided BROWSER_USE_PROFILE_ID.
Do not send marketplace messages or accept offers without final user confirmation.

Conversation history:
${history || '- No previous messages.'}

Latest user message:
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

    if (process.env.CODEX_RUNTIME !== 'exec') {
      const enqueued = await ctx.runMutation(
        enqueueAgentPhoneMessageForAppServerRef,
        {
          webhookId: args.webhookId,
          phoneNumber,
          channel: payload.channel,
          prompt: payload.data.message,
          conversationId: payload.data.conversationId,
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

      try {
        if (enqueued.kind === 'steer') {
          const steered = await steerAppServerTurn(ctx, {
            runId: enqueued.runId,
            phoneNumber,
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
          sandboxName: sandboxNameForPhone(phoneNumber),
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

    try {
      await killInterruptedRemoteProcess(enqueued.interruptedRun)
      const remoteRun = await startQueuedRemoteCodexRun(ctx, {
        runId: enqueued.runId,
        phoneNumber,
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
        await ctx.runMutation(markAppServerTurnCompletedRef, {
          runId: args.runId,
          processStatus:
            bridgeResult.threadStatusType ?? bridgeResult.turnStatus,
        })
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
      return null
    }
  },
})
