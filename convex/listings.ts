import { v } from 'convex/values'
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'

const EMBEDDING_DIMS = 768
const EMBEDDING_MODEL = 'gemini-embedding-001'

const now = () => Date.now()

async function callGeminiEmbedding(
  text: string,
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in Convex env')

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType,
        outputDimensionality: EMBEDDING_DIMS,
      }),
    },
  )

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Gemini embedding ${res.status}: ${body}`)
  }

  const json = (await res.json()) as { embedding: { values: number[] } }
  return json.embedding.values
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query('listings')
      .withIndex('by_status', (q) => q.eq('status', 'active'))
      .collect()
  },
})

export const get = query({
  args: { listingId: v.id('listings') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.listingId)
  },
})

export const getForEmbedding = internalQuery({
  args: { listingId: v.id('listings') },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.listingId)
  },
})

export const checkOffer = query({
  args: { listingId: v.id('listings'), amount: v.number() },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get(args.listingId)
    if (!listing) return { accepted: false, reason: 'not_found' as const }
    if (listing.status !== 'active')
      return { accepted: false, reason: 'sold' as const }
    const floor = listing.askingPrice * 0.9
    if (args.amount >= floor)
      return {
        accepted: true as const,
        finalPrice: args.amount,
        currency: listing.currency,
      }
    return { accepted: false, reason: 'too_low' as const }
  },
})

export const book = mutation({
  args: {
    listingId: v.id('listings'),
    slotIso: v.string(),
    finalPrice: v.number(),
    customerPhone: v.optional(v.string()),
    callId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const listing = await ctx.db.get(args.listingId)
    if (!listing) return { confirmed: false, reason: 'not_found' as const }
    if (listing.status !== 'active')
      return { confirmed: false, reason: 'already_booked' as const }

    await ctx.db.patch(args.listingId, {
      status: 'sold',
      updatedAt: now(),
    })
    await ctx.db.insert('bookings', {
      listingId: args.listingId,
      slotIso: args.slotIso,
      finalPrice: args.finalPrice,
      customerPhone: args.customerPhone,
      callId: args.callId,
      createdAt: now(),
    })

    return {
      confirmed: true as const,
      listingId: args.listingId,
      slotIso: args.slotIso,
    }
  },
})

export const create = mutation({
  args: {
    title: v.string(),
    description: v.string(),
    askingPrice: v.number(),
    currency: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('listings', {
      title: args.title,
      description: args.description,
      askingPrice: args.askingPrice,
      currency: args.currency ?? 'USD',
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    })
    await ctx.scheduler.runAfter(0, internal.listings.embedListing, {
      listingId: id,
    })
    return id
  },
})

export const setEmbedding = internalMutation({
  args: {
    listingId: v.id('listings'),
    embedding: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.listingId, {
      embedding: args.embedding,
      updatedAt: now(),
    })
  },
})

export const embedListing = internalAction({
  args: { listingId: v.id('listings') },
  handler: async (ctx, args) => {
    const listing = await ctx.runQuery(internal.listings.getForEmbedding, {
      listingId: args.listingId,
    })
    if (!listing) return
    const embedding = await callGeminiEmbedding(
      `${listing.title}. ${listing.description}`,
      'RETRIEVAL_DOCUMENT',
    )
    await ctx.runMutation(internal.listings.setEmbedding, {
      listingId: args.listingId,
      embedding,
    })
  },
})

export const search = action({
  args: { query: v.string(), topK: v.optional(v.number()) },
  handler: async (
    ctx,
    args,
  ): Promise<{
    results: Array<{
      listingId: Id<'listings'>
      title: string
      description: string
      askingPrice: number
      currency: string
      score: number
    }>
  }> => {
    const qVec = await callGeminiEmbedding(args.query, 'RETRIEVAL_QUERY')
    const limit = args.topK ?? 3
    const hits = await ctx.vectorSearch('listings', 'by_embedding', {
      vector: qVec,
      limit,
      filter: (q) => q.eq('status', 'active'),
    })

    const results = await Promise.all(
      hits.map(async (hit) => {
        const doc = await ctx.runQuery(internal.listings.getForEmbedding, {
          listingId: hit._id,
        })
        if (!doc) return null
        return {
          listingId: doc._id,
          title: doc.title,
          description: doc.description,
          askingPrice: doc.askingPrice,
          currency: doc.currency,
          score: Math.round(hit._score * 100) / 100,
        }
      }),
    )
    return { results: results.filter((r): r is NonNullable<typeof r> => !!r) }
  },
})

export const seedDemo = mutation({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.db.query('listings').first()
    if (existing) return { seeded: false, reason: 'already_seeded' as const }

    const samples = [
      {
        title: 'IKEA Markus office chair',
        description:
          'Black mesh ergonomic office chair, used about 2 years, no rips or stains, fully adjustable. Pickup only.',
        askingPrice: 120,
      },
      {
        title: 'iPhone 14 Pro 256GB',
        description:
          'Space black, unlocked, battery health 91 percent, original box and cable, small scratch on the back.',
        askingPrice: 580,
      },
      {
        title: 'Yamaha FG800 acoustic guitar',
        description:
          'Solid spruce top, includes soft case and capo, light pick wear on the soundhole, plays beautifully.',
        askingPrice: 180,
      },
      {
        title: 'Vintage tan leather sofa',
        description:
          'Three-seater real leather mid-century style, patina on the arms, structurally solid.',
        askingPrice: 400,
      },
      {
        title: 'Trek Marlin 5 mountain bike',
        description:
          'Medium frame, 29 inch wheels, new tires last spring, hydraulic disc brakes recently serviced.',
        askingPrice: 350,
      },
    ]

    const ids: Array<Id<'listings'>> = []
    for (const sample of samples) {
      const id = await ctx.db.insert('listings', {
        ...sample,
        currency: 'USD',
        status: 'active',
        createdAt: now(),
        updatedAt: now(),
      })
      ids.push(id)
      await ctx.scheduler.runAfter(0, internal.listings.embedListing, {
        listingId: id,
      })
    }
    return { seeded: true as const, count: ids.length }
  },
})
