import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

crons.interval(
  'maintain Blaxel reserve sandbox pool',
  { minutes: 1 },
  internal.agentphoneWebhook.maintainSandboxReservePool,
  {},
)

export default crons
