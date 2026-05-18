#!/usr/bin/env bun
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Effect } from 'effect'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { BrowserExecute } from './vendor/bcode-browser/src/browser-execute.ts'

const MAX_METADATA_LENGTH = 30_000
const preview = (text: string) =>
  text.length <= MAX_METADATA_LENGTH
    ? text
    : '...\n\n' + text.slice(-MAX_METADATA_LENGTH)

const dataDir =
  process.env.BROWSERCODE_DATA_DIR ??
  path.join(os.homedir(), '.cache', 'codex-browsercode', 'data')

const service = await Effect.runPromise(BrowserExecute.make(dataDir))
const descriptionPath = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'vendor',
  'bcode-browser',
  'browser-execute.txt',
)
const toolDescription = (await fs.readFile(descriptionPath, 'utf8')).replaceAll(
  '{{SKILLS_DIR}}',
  service.skillsDir,
)

const server = new McpServer({
  name: 'browsercode',
  version: '0.1.0',
})

async function sendAgentPhoneMessage(input: {
  body: string
  mediaUrl?: string
}) {
  const apiKey = process.env.AGENTPHONE_API_KEY
  const agentId = process.env.AGENTPHONE_AGENT_ID
  const toNumber = process.env.GAVEL_USER_PHONE_NUMBER
  if (!apiKey) throw new Error('AGENTPHONE_API_KEY is not set')
  if (!agentId) throw new Error('AGENTPHONE_AGENT_ID is not set')
  if (!toNumber) throw new Error('GAVEL_USER_PHONE_NUMBER is not set')

  const body = input.body.trim()
  const mediaUrl = input.mediaUrl?.trim()
  if (!body && !mediaUrl) {
    throw new Error('message body or mediaUrl is required')
  }

  const requestBody: {
    agent_id: string
    to_number: string
    body: string
    media_url?: string
    number_id?: string
  } = {
    agent_id: agentId,
    to_number: toNumber,
    body,
  }
  if (mediaUrl) requestBody.media_url = mediaUrl
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
    ok: true,
    agentPhoneMessageId: typeof messageId === 'string' ? messageId : undefined,
  }
}

const formatBrowserCodeOutput = (result: {
  output: string
  result: string
  screenshots: readonly unknown[]
}) =>
  [
    result.output.trimEnd(),
    result.result === 'null' ? '' : `=> ${result.result}`,
    result.screenshots.length > 0
      ? `(${result.screenshots.length} screenshot${result.screenshots.length === 1 ? '' : 's'} attached)`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

const projectDirFromRoots = async () => {
  const roots = await server.server.listRoots(undefined, { timeout: 5_000 })
  const projectRoots = roots.roots
    .filter((root) => root.uri.startsWith('file://'))
    .map((root) => fileURLToPath(root.uri))

  if (projectRoots.length === 0) return undefined
  if (projectRoots.length === 1) return projectRoots[0]

  const cwd = process.cwd()
  const cwdMatches = projectRoots.filter(
    (root) => cwd === root || cwd.startsWith(root + path.sep),
  )
  if (cwdMatches.length === 1) return cwdMatches[0]

  throw new Error(
    `multiple MCP file roots were provided; cannot choose project root: ${projectRoots.join(', ')}`,
  )
}

server.registerTool(
  'browser_execute',
  {
    title: 'browser_execute',
    description: toolDescription,
    inputSchema: {
      code: z
        .string()
        .describe(
          'The JavaScript snippet to execute. `session` (CDP Session) and `console` are in scope; see the `browser-execute` skill for the snippet model.',
        ),
      timeout: z
        .number()
        .optional()
        .describe(
          'Optional timeout in milliseconds (default 60000, max 600000)',
        ),
      description: z
        .string()
        .describe(
          'Clear, concise description of what this snippet does in 3-7 words. Examples:\nInput: code that connects to local Chrome\nOutput: Connect to local Chrome\n\nInput: scrape product titles from current page\nOutput: Scrape product titles\n\nInput: capture a screenshot of the homepage\nOutput: Screenshot homepage',
        ),
    },
  },
  async (args, extra) => {
    if (!extra.sessionId) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: 'browser_execute requires an MCP transport session id; no session id was provided by the host.',
          },
        ],
      }
    }
    const sessionID = extra.sessionId
    let workspaceDir: string | undefined
    try {
      const projectDir = await projectDirFromRoots()
      if (!projectDir) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'browser_execute requires an MCP file root from the host; no project root was provided.',
            },
          ],
        }
      }
      const runWorkspaceDir = path.join(projectDir, '.bcode', 'agent-workspace')
      workspaceDir = runWorkspaceDir
      const result = await Effect.runPromise(
        service.execute(
          {
            code: args.code,
            timeout: args.timeout,
            description: args.description,
          },
          {
            sessionID,
            workspaceDir: runWorkspaceDir,
            onChunk: (output) => {
              const progressToken = extra._meta?.progressToken
              if (progressToken === undefined) return Effect.void
              return Effect.promise(() =>
                extra.sendNotification({
                  method: 'notifications/progress',
                  params: {
                    progressToken,
                    progress: output.length,
                    message: preview(output),
                  },
                }),
              )
            },
          },
        ),
      )
      return {
        content: [
          {
            type: 'text',
            text: formatBrowserCodeOutput(result),
          },
          ...result.screenshots.map((screenshot) => ({
            type: 'image' as const,
            data: screenshot.base64,
            mimeType: screenshot.mime,
          })),
        ],
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ok: false,
                sessionID,
                workspaceDir,
                error:
                  err instanceof Error
                    ? (err.stack ?? err.message)
                    : String(err),
              },
              null,
              2,
            ),
          },
        ],
      }
    }
  },
)

server.registerTool(
  'send_user_message',
  {
    title: 'send_user_message',
    description:
      'Send an SMS/iMessage update to the current Gavel user during a turn. Use this for live progress updates, including the Browser Use live preview URL once available. The recipient phone number is fixed by GAVEL_USER_PHONE_NUMBER in the runtime; do not include phone numbers in the input.',
    inputSchema: {
      body: z
        .string()
        .describe(
          'Plain text message body to send to the current user. Keep it concise and SMS-friendly.',
        ),
      mediaUrl: z
        .string()
        .url()
        .optional()
        .describe('Optional media URL to attach to the outbound message.'),
    },
  },
  async (args) => {
    try {
      const result = await sendAgentPhoneMessage(args)
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      }
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: err instanceof Error ? err.message : String(err),
          },
        ],
      }
    }
  },
)

await server.connect(new StdioServerTransport())
