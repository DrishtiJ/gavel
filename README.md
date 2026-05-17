# Gavel

Gavel helps you sell stuff by messaging an agent. Tell it what you want to sell, and it handles the work: creates the Craigslist post, manages buyer demand, drafts replies, compares offers, and coordinates the next steps. When it is ready to act, it messages you once for final confirmation, then finishes the sale flow.

The app is built with TanStack Start, Convex, AgentPhone, Blaxel, BrowserCode,
and Vite+.

## Development

Install dependencies:

```bash
vp install
```

Set up a Convex dev deployment:

```bash
npx convex dev
```

For normal local development, run the app and Convex together:

```bash
vp run dev
```

### Shared Hackathon Convex Deployment

The shared team backend is the default production deployment in the
`Call My Agent Hackathon / gavel` Convex project:

```bash
VITE_CONVEX_URL=https://greedy-iguana-778.convex.cloud
```

Use your personal dev deployment for local hacking:

```bash
npx convex deployment select dev
vp run dev
```

Push shared backend changes to the hackathon deployment:

```bash
npx convex deploy --yes
```

Open the shared backend dashboard:

```bash
npx convex dashboard --prod
```

Vercel/demo environments should use the shared production `VITE_CONVEX_URL`.

Useful checks:

```bash
vp check
vp test
vp build
```

## Agent Runtime

Gavel's MVP user identity is the sender phone number from AgentPhone webhooks.
Configure AgentPhone to deliver inbound messages to the Convex HTTP action:

```text
POST https://<convex-deployment>.convex.site/api/agentphone/webhook
```

Required server environment:

```bash
AGENTPHONE_WEBHOOK_SECRET=
BL_WORKSPACE=
BL_API_KEY=
BLAXEL_CODEX_BROWSERCODE_IMAGE=
OPENAI_API_KEY=
BROWSER_USE_API_KEY=
```

Seed a manually created Browser Use profile for a phone number:

```bash
scripts/seed-browser-profile.ts +15551234567 browser-use-profile-id
```

Start a local Blaxel/Codex smoke run:

```bash
scripts/start-blaxel-codex-smoke.ts +15551234567 browser-use-profile-id
```

Push the Blaxel sandbox image:

```bash
blaxel/codex-browsercode/push.sh
```

### Current Runtime Shape

The current implementation uses Convex as the durable control plane and Blaxel as
the remote execution layer:

```text
AgentPhone webhook
  -> Convex HTTP action
  -> internal Node action for AgentPhone verification and Blaxel startup
  -> Convex agentRuntime mutations for durable state
  -> per-user Blaxel sandbox
  -> Codex CLI with BrowserCode MCP
  -> Browser Use cloud profile
```

Today, "user" means the normalized sender phone number from AgentPhone. The app
hashes that phone number into a deterministic Blaxel sandbox name:

```text
gavel-user-<sha256(phoneNumber).slice(0, 24)>
```

Because sandbox creation uses `SandboxInstance.createIfNotExists`, each phone
user gets one reused Blaxel sandbox instead of a new machine per task. Individual
messages still start separate `codex exec` processes inside that reused sandbox.
Sandboxes are not configured with an automatic deletion policy; they are meant
to be durable per-user runtimes and can be stopped or managed from Blaxel.

Convex stores:

- `phoneUsers`: sender phone identities
- `browserProfiles`: Browser Use profile IDs for phone users
- `agentSandboxes`: Blaxel sandbox lifecycle state
- `agentRuns`: inbound agent tasks and remote process state
- `agentRunEvents`: ordered progress/error events

Browser Use profiles are created manually for now, then seeded into Convex with
`scripts/seed-browser-profile.ts`. Do not commit Browser Use profile IDs or API
keys. The remote Codex process receives `BROWSER_USE_PROFILE_ID` only as process
environment for that run.

### What Is Implemented

- AgentPhone webhook verification and idempotency by webhook ID.
- Native Convex HTTP route at `/api/agentphone/webhook`.
- Phone-number based user creation.
- Browser Use profile lookup per phone user.
- Per-user Blaxel sandbox naming and `createIfNotExists` reuse.
- Custom Blaxel sandbox image under `blaxel/codex-browsercode`.
- BrowserCode MCP plugin vendored under `plugins/browsercode`.
- Remote `codex exec` launch inside the user sandbox.
- Convex run/sandbox status updates for queued, starting, running, completed,
  and failed states.
- Scheduled Convex monitoring for Blaxel process status and Codex JSONL logs,
  appended into `agentRunEvents`.
- Per-phone-user active run locking with `phoneUsers.activeRunId`, so concurrent
  webhooks cannot start multiple Codex processes in the same sandbox.

### Important Gaps For Contributors

- Queued follow-up runs do not drain automatically after the active run finishes.
  Completion clears `activeRunId`, but the next queued run is not claimed and
  started automatically yet.
- The runtime is not yet a long-lived OpenAI Realtime voice worker. AgentPhone
  handles phone transport/STT/TTS, and each inbound message currently maps to a
  Codex run.
- Human approval checkpoints are prompt-level instructions only. The product
  still needs explicit approval state before sending marketplace messages,
  accepting offers, or committing to logistics.

Additional design notes live in:

- `docs/blaxel-codex-browsercode-integration.md`
- `docs/agentphone-openai-voice-integration.md`
