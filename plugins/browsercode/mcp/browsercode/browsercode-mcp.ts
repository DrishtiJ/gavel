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

await server.connect(new StdioServerTransport())
