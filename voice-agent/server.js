import 'dotenv/config'
import express from 'express'
import crypto from 'node:crypto'
import { GoogleGenAI } from '@google/genai'
import { ConvexHttpClient } from 'convex/browser'

const {
  PORT = 3000,
  GEMINI_API_KEY,
  GEMINI_MODEL = 'gemini-2.5-flash-lite',
  AGENTPHONE_WEBHOOK_SECRET,
  CONVEX_URL,
} = process.env

if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is required')
if (!CONVEX_URL) throw new Error('CONVEX_URL is required')

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
const convex = new ConvexHttpClient(CONVEX_URL)

const SYSTEM_PROMPT = `You are a seller answering phone calls about items you have posted for sale.

Your words are spoken aloud by a text-to-speech voice. Write the way you would talk: short sentences, no markdown, no lists, no emoji, no asterisks. One or two sentences per turn. Spell out times in plain English like "tomorrow at five PM" — never read ISO timestamps aloud.

You do not know the catalog up front. Use search_listings to find items the caller describes.

Call flow:
1. When the caller mentions an item, call search_listings with what they said. It returns the top matches with similarity scores. Trust the top result if its score is high (above roughly 0.6). If the top score is low, ask a clarifying question rather than guessing. NEVER invent a listingId.
2. Use the matched listingId to call get_listing if you need more detail. Quote the asking price in dollars.
3. If they negotiate, call make_offer with their amount. If the server returns accepted, confirm the new price warmly. If rejected, push back firmly but politely — say the offer is too low, ask if they can come up. Never reveal the minimum you would accept. Make them work for the discount.
4. Once price is agreed, call get_pickup_slots once and read two of the human-readable labels aloud. Wait for them to pick one.
5. When they pick a time, call book_pickup ONCE with the matching slotIso and the agreed finalPrice. Do not call book_pickup more than once per call.

Tone: warm, businesslike, like a regular person selling on Facebook Marketplace. Be willing to negotiate but not a pushover.`

const history = new Map()

function generateSlotDates() {
  const dates = []
  const now = new Date()
  const hours = [10, 14, 17]
  for (let day = 1; day <= 2 && dates.length < 5; day++) {
    for (const h of hours) {
      const d = new Date(now)
      d.setDate(d.getDate() + day)
      d.setHours(h, 0, 0, 0)
      dates.push(d)
      if (dates.length >= 5) break
    }
  }
  return dates
}

function formatSlot(date) {
  const now = new Date()
  const dayDiff = Math.round((date - now) / 86_400_000)
  const dayLabel =
    dayDiff <= 1
      ? 'tomorrow'
      : dayDiff === 2
        ? 'the day after tomorrow'
        : date.toLocaleDateString('en-US', { weekday: 'long' })
  const time = date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: date.getMinutes() ? '2-digit' : undefined,
    hour12: true,
  })
  return `${dayLabel} at ${time}`
}

function getPickupSlots() {
  const slots = generateSlotDates().map((d) => ({
    slotIso: d.toISOString(),
    label: formatSlot(d),
  }))
  return { slots }
}

function makeToolImpls(callId, customerPhone) {
  return {
    search_listings: async ({ query }) =>
      await convex.action('listings:search', { query: String(query ?? '') }),
    get_listing: async ({ listingId }) =>
      await convex.query('listings:get', { listingId }),
    make_offer: async ({ listingId, amount }) =>
      await convex.query('listings:checkOffer', {
        listingId,
        amount: Number(amount),
      }),
    get_pickup_slots: async () => getPickupSlots(),
    book_pickup: async ({ listingId, slotIso, finalPrice }) =>
      await convex.mutation('listings:book', {
        listingId,
        slotIso: String(slotIso),
        finalPrice: Number(finalPrice),
        customerPhone,
        callId,
      }),
  }
}

const TOOLS = [
  {
    functionDeclarations: [
      {
        name: 'search_listings',
        description:
          "Semantic search over the seller's catalog. Returns the top matches with cosine similarity scores. Use this first whenever the caller mentions a specific item.",
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'What the caller said they want, in their own words.',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'get_listing',
        description:
          'Get full details about a specific listing by id, including current availability.',
        parameters: {
          type: 'object',
          properties: {
            listingId: { type: 'string' },
          },
          required: ['listingId'],
        },
      },
      {
        name: 'make_offer',
        description:
          "Submit a price offer for a listing. The server checks if it meets the seller's minimum and returns whether accepted. Never reveal the minimum.",
        parameters: {
          type: 'object',
          properties: {
            listingId: { type: 'string' },
            amount: { type: 'number' },
          },
          required: ['listingId', 'amount'],
        },
      },
      {
        name: 'get_pickup_slots',
        description:
          "Get the seller's available pickup time slots. Returns ISO timestamps and human-readable labels for speaking aloud.",
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'book_pickup',
        description:
          'Book a pickup slot for a listing after price is agreed. Use one of the slotIso values returned by get_pickup_slots.',
        parameters: {
          type: 'object',
          properties: {
            listingId: { type: 'string' },
            slotIso: { type: 'string' },
            finalPrice: { type: 'number' },
          },
          required: ['listingId', 'slotIso', 'finalPrice'],
        },
      },
    ],
  },
]

const app = express()

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf
    },
  }),
)

function verifySignature(req) {
  if (!AGENTPHONE_WEBHOOK_SECRET) return true
  const signature = req.get('x-webhook-signature')
  const timestamp = req.get('x-webhook-timestamp')
  if (!signature || !timestamp || !req.rawBody) return false

  const signedAt = Number.parseInt(timestamp, 10)
  if (!Number.isFinite(signedAt)) return false
  if (Math.abs(Date.now() / 1000 - signedAt) > 300) return false

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', AGENTPHONE_WEBHOOK_SECRET)
      .update(`${timestamp}.${req.rawBody.toString('utf8')}`)
      .digest('hex')

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  } catch {
    return false
  }
}

async function runConversationTurn(turns, toolImpls) {
  for (let i = 0; i < 5; i++) {
    const result = await ai.models.generateContent({
      model: GEMINI_MODEL,
      contents: turns,
      config: { systemInstruction: SYSTEM_PROMPT, tools: TOOLS },
    })

    const modelParts = result.candidates?.[0]?.content?.parts ?? []
    turns.push({ role: 'model', parts: modelParts })

    const calls = result.functionCalls ?? []
    if (calls.length === 0) {
      return result.text?.trim() ?? ''
    }

    const responseParts = await Promise.all(
      calls.map(async (call) => {
        const impl = toolImpls[call.name]
        const response = impl
          ? await impl(call.args ?? {})
          : { error: 'unknown_tool' }
        console.log('tool:', call.name, call.args, '→', response)
        return { functionResponse: { name: call.name, response } }
      }),
    )
    turns.push({ role: 'user', parts: responseParts })
  }
  return 'Sorry, I got a bit tangled up. Could you say that again?'
}

app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) return res.status(401).send('bad signature')

  const event = req.body
  const data = event?.data ?? {}
  const callId = data.callId ?? data.conversationId ?? 'unknown'

  if (event?.event === 'agent.call_ended') {
    history.delete(callId)
    console.log('call ended, cleared state for', callId)
    return res.status(200).json({})
  }

  if (event?.event !== 'agent.message' || event?.channel !== 'voice') {
    return res.status(200).json({})
  }

  const userText = data.transcript ?? data.text ?? ''
  if (!userText) return res.status(200).json({})

  const turns = history.get(callId) ?? []
  turns.push({ role: 'user', parts: [{ text: userText }] })

  const toolImpls = makeToolImpls(callId, data.from)

  try {
    const reply = await runConversationTurn(turns, toolImpls)
    history.set(callId, turns)
    return res.json({ text: reply })
  } catch (err) {
    console.error('agent error:', err)
    return res.json({ text: 'Sorry, I had a problem. Could you repeat that?' })
  }
})

app.get('/health', (_req, res) => res.send('ok'))

app.listen(PORT, () =>
  console.log(`voice agent listening on :${PORT} (convex: ${CONVEX_URL})`),
)
