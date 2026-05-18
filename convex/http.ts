import {
  httpRouter,
  makeFunctionReference,
  type FunctionReference,
} from 'convex/server'
import { httpAction } from './_generated/server'

const handleAgentPhoneWebhookRef = makeFunctionReference(
  'agentphoneWebhook:handleAgentPhoneWebhook',
) as unknown as FunctionReference<
  'action',
  'internal',
  {
    rawBody: string
    signature: string | null
    timestamp: string | null
    webhookId: string | null
  },
  {
    status: number
    body: Record<string, unknown>
  }
>

const handleExternalAgentNotificationRef = makeFunctionReference(
  'agentphoneWebhook:handleExternalAgentNotification',
) as unknown as FunctionReference<
  'action',
  'internal',
  {
    rawBody: string
    authorization: string | null
    secret: string | null
    idempotencyKey: string | null
  },
  {
    status: number
    body: Record<string, unknown>
  }
>

const http = httpRouter()

http.route({
  path: '/api/agentphone/webhook',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const result = await ctx.runAction(handleAgentPhoneWebhookRef, {
      rawBody: await request.text(),
      signature: request.headers.get('x-webhook-signature'),
      timestamp: request.headers.get('x-webhook-timestamp'),
      webhookId: request.headers.get('x-webhook-id'),
    })

    return Response.json(result.body, { status: result.status })
  }),
})

http.route({
  path: '/api/agent/notify',
  method: 'POST',
  handler: httpAction(async (ctx, request) => {
    const result = await ctx.runAction(handleExternalAgentNotificationRef, {
      rawBody: await request.text(),
      authorization: request.headers.get('authorization'),
      secret: request.headers.get('x-gavel-agent-secret'),
      idempotencyKey: request.headers.get('idempotency-key'),
    })

    return Response.json(result.body, { status: result.status })
  }),
})

export default http
