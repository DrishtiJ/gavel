#!/usr/bin/env bun
import { ConvexHttpClient } from 'convex/browser'
import { api } from '../convex/_generated/api'

const [phoneNumber, browserUseProfileId] = process.argv.slice(2)
const convexUrl = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL

if (!convexUrl) {
  throw new Error('CONVEX_URL or VITE_CONVEX_URL is required')
}

if (!phoneNumber || !browserUseProfileId) {
  throw new Error(
    'Usage: scripts/seed-browser-profile.ts <e164-phone-number> <browser-use-profile-id>',
  )
}

const convex = new ConvexHttpClient(convexUrl)
const id = await convex.mutation(api.agentRuntime.setBrowserProfileForPhone, {
  phoneNumber,
  browserUseProfileId,
})

console.log(
  `Saved Browser Use profile ${browserUseProfileId} for ${phoneNumber}`,
)
console.log(`browserProfiles id: ${id}`)
