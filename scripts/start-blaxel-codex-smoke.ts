#!/usr/bin/env bun
import { startRemoteCodexRun } from '../src/server/blaxel'

const [phoneNumber, browserUseProfileId] = process.argv.slice(2)

if (!phoneNumber || !browserUseProfileId) {
  throw new Error(
    'Usage: scripts/start-blaxel-codex-smoke.ts <e164-phone-number> <browser-use-profile-id>',
  )
}

const run = await startRemoteCodexRun({
  runId: `smoke-${Date.now()}`,
  phoneNumber,
  browserUseProfileId,
  prompt:
    'Smoke test only. Reply with a short final summary and do not navigate anywhere.',
})

console.log(JSON.stringify(run, null, 2))
