import { createHash } from 'node:crypto'
import { SandboxInstance } from '@blaxel/core'

export type StartRemoteCodexRunInput = {
  runId: string
  phoneNumber: string
  prompt: string
  browserUseProfileId: string
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
    lifecycle: {
      expirationPolicies: [
        {
          type: 'ttl-idle',
          value: process.env.BLAXEL_SANDBOX_IDLE_TTL ?? '24h',
          action: 'delete',
        },
      ],
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
    '--ask-for-approval never',
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
