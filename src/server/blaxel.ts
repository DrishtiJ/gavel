import { createHash } from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'
import { gavelAgentInstructions } from '../../convex/gavelAgentInstructions'

export type StartRemoteCodexRunInput = {
  runId: string
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
  codexThreadId?: string
  conversationHistory?: Array<{
    role: 'user' | 'agent' | 'system' | 'external'
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
const gavelAgentInstructionsPath = '/workspace/gavel-agent/AGENTS.md'

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
  await sandbox.fs.write(gavelAgentInstructionsPath, gavelAgentInstructions)

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
