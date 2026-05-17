import { createHash } from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'

export type StartRemoteCodexRunInput = {
  runId: string
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory?: Array<{
    role: 'user' | 'agent' | 'system'
    body: string
    createdAt: number
  }>
}

export type RemoteCodexRun = {
  sandboxName: string
  image: string
  region: string | undefined
  processName: string
  processStatus: string
}

const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

export function sandboxNameForPhone(phoneNumber: string) {
  const digest = createHash('sha256').update(phoneNumber).digest('hex')
  return `gavel-user-${digest.slice(0, 24)}`
}

export async function startRemoteCodexRun(
  input: StartRemoteCodexRunInput,
): Promise<RemoteCodexRun> {
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

function buildRunPrompt(input: StartRemoteCodexRunInput) {
  const history = (input.conversationHistory ?? [])
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
