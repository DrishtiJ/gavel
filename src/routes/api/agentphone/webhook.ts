import { ConvexHttpClient } from 'convex/browser'
import { createFileRoute } from '@tanstack/react-router'
import { api } from '../../../../convex/_generated/api'
import {
  isSupportedMessageWebhook,
  normalizeAgentPhoneNumber,
  verifyAgentPhoneWebhook,
  type AgentPhoneWebhookPayload,
} from '~/server/agentphone'
import { sandboxNameForPhone, startRemoteCodexRun } from '~/server/blaxel'

const convexUrl = () => {
  const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL
  if (!url) throw new Error('CONVEX_URL or VITE_CONVEX_URL is not set')
  return url
}

export const Route = createFileRoute('/api/agentphone/webhook')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawBody = await request.text()
        const signature = request.headers.get('x-webhook-signature')
        const timestamp = request.headers.get('x-webhook-timestamp')
        const webhookId = request.headers.get('x-webhook-id')

        if (
          !verifyAgentPhoneWebhook({
            rawBody,
            signature,
            timestamp,
            secret: process.env.AGENTPHONE_WEBHOOK_SECRET,
          })
        ) {
          return Response.json(
            { ok: false, error: 'invalid signature' },
            { status: 401 },
          )
        }

        if (!webhookId) {
          return Response.json(
            { ok: false, error: 'missing webhook id' },
            { status: 400 },
          )
        }

        let payload: AgentPhoneWebhookPayload
        try {
          payload = JSON.parse(rawBody) as AgentPhoneWebhookPayload
        } catch {
          return Response.json(
            { ok: false, error: 'invalid json' },
            { status: 400 },
          )
        }

        if (!isSupportedMessageWebhook(payload)) {
          return Response.json({ ok: true, ignored: true })
        }

        const phoneNumber = normalizeAgentPhoneNumber(payload.data.from)
        if (!phoneNumber) {
          return Response.json(
            { ok: false, error: 'invalid sender phone number' },
            { status: 400 },
          )
        }

        const convex = new ConvexHttpClient(convexUrl())
        const enqueued = await convex.mutation(
          api.agentRuntime.enqueueAgentPhoneMessage,
          {
            webhookId,
            phoneNumber,
            channel: payload.channel,
            prompt: payload.data.message,
            conversationId: payload.data.conversationId,
          },
        )

        if (enqueued.kind === 'duplicate') {
          return Response.json({
            ok: true,
            duplicate: true,
            runId: enqueued.runId,
          })
        }

        if (enqueued.kind === 'needs_profile') {
          return Response.json({
            ok: true,
            status: 'needs_profile',
            runId: enqueued.runId,
          })
        }

        const sandboxName = sandboxNameForPhone(phoneNumber)
        const browserUseProfileId = enqueued.browserUseProfileId
        if (!browserUseProfileId) {
          await convex.mutation(api.agentRuntime.markRunFailed, {
            runId: enqueued.runId,
            sandboxName,
            error: 'Browser Use profile is missing for this phone number',
          })
          return Response.json(
            { ok: false, error: 'browser profile is not configured' },
            { status: 500 },
          )
        }

        const image = process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE
        if (!image) {
          await convex.mutation(api.agentRuntime.markRunFailed, {
            runId: enqueued.runId,
            sandboxName,
            error: 'BLAXEL_CODEX_BROWSERCODE_IMAGE is not set',
          })
          return Response.json(
            { ok: false, error: 'runtime image is not configured' },
            { status: 500 },
          )
        }

        try {
          await convex.mutation(api.agentRuntime.markRunStarting, {
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
          await convex.mutation(api.agentRuntime.markRunRemoteStarted, {
            runId: enqueued.runId,
            sandboxName: remoteRun.sandboxName,
            processName: remoteRun.processName,
            processStatus: remoteRun.processStatus,
          })

          return Response.json({
            ok: true,
            status: 'running',
            runId: enqueued.runId,
            sandboxName: remoteRun.sandboxName,
            processName: remoteRun.processName,
          })
        } catch (err) {
          await convex.mutation(api.agentRuntime.markRunFailed, {
            runId: enqueued.runId,
            sandboxName,
            error: err instanceof Error ? err.message : String(err),
          })

          return Response.json(
            { ok: false, error: 'failed to start remote codex run' },
            { status: 500 },
          )
        }
      },
    },
  },
})
