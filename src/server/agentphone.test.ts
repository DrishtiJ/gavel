import { createHmac } from 'node:crypto'
import { expect, test } from 'vite-plus/test'
import {
  normalizeAgentPhoneNumber,
  verifyAgentPhoneWebhook,
} from './agentphone'

const secret = 'test-secret'
const rawBody = JSON.stringify({
  event: 'agent.message',
  channel: 'sms',
  data: {
    from: '+15551234567',
    message: 'Sell my bike',
  },
})
const timestamp = '1760000000'

const signatureFor = (body: string, ts = timestamp) =>
  `sha256=${createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex')}`

test('verifies a valid AgentPhone webhook signature', () => {
  expect(
    verifyAgentPhoneWebhook({
      rawBody,
      signature: signatureFor(rawBody),
      timestamp,
      secret,
      nowSeconds: Number(timestamp),
    }),
  ).toBe(true)
})

test('rejects invalid AgentPhone webhook signatures', () => {
  expect(
    verifyAgentPhoneWebhook({
      rawBody,
      signature: 'sha256=bad',
      timestamp,
      secret,
      nowSeconds: Number(timestamp),
    }),
  ).toBe(false)
})

test('rejects stale AgentPhone webhook timestamps', () => {
  expect(
    verifyAgentPhoneWebhook({
      rawBody,
      signature: signatureFor(rawBody),
      timestamp,
      secret,
      nowSeconds: Number(timestamp) + 301,
    }),
  ).toBe(false)
})

test('normalizes AgentPhone sender phone numbers', () => {
  expect(normalizeAgentPhoneNumber('+1 (555) 123-4567')).toBe('+15551234567')
  expect(normalizeAgentPhoneNumber('5551234567')).toBe(null)
})
