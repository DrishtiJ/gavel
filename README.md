# Gavel

Gavel helps you sell stuff by messaging an agent. Tell it what you want to sell;
it creates listings, handles buyer demand, compares offers, drafts replies, and
asks for confirmation before taking irreversible actions.

The app is built with TanStack Start, Convex, AgentPhone, Blaxel, BrowserCode,
and Vite+.

## Development

Install dependencies:

```bash
vp install
```

Run the app and Convex together:

```bash
vp run dev
```

Useful checks:

```bash
vp check
vp test
vp build
```

## Environment

Required server environment:

```bash
AGENTPHONE_WEBHOOK_SECRET=
AGENT_NOTIFY_SECRET=
BL_WORKSPACE=
BL_API_KEY=
BLAXEL_CODEX_BROWSERCODE_IMAGE=
BROWSER_USE_API_KEY=
```

Remote Codex auth requires one of:

```bash
OPENAI_API_KEY=
CODEX_ACCESS_TOKEN=
CODEX_AUTH_JSON_B64=
```

`CODEX_AUTH_JSON_B64` is a base64-encoded Codex auth cache for trusted
headless runners. Do not commit or log it.

Client/demo environments also need:

```bash
VITE_CONVEX_URL=
```

## Agent Runtime

AgentPhone should send inbound messages to the Convex HTTP action:

```text
POST https://<convex-deployment>.convex.site/api/agentphone/webhook
```

External systems, such as a buyer-facing phone agent, can notify the seller's
ongoing Codex thread through:

```text
POST https://<convex-deployment>.convex.site/api/agent/notify
Authorization: Bearer <AGENT_NOTIFY_SECRET>
```

Use the seller's E.164 phone number as `phoneNumber`, not the Gavel/AgentPhone
number. Provide a stable `notificationId` or `Idempotency-Key` header for
deduplication.

Runtime flow:

```text
AgentPhone webhook
  -> Convex HTTP action
  -> Blaxel per-user sandbox
  -> Codex CLI with BrowserCode MCP
  -> Browser Use cloud profile
  -> Convex run state and progress events
```

For the MVP, the sender phone number is the user identity. Each phone user gets
one reusable Blaxel sandbox and one Browser Use profile. Convex also maintains a
small reserve pool of ready Blaxel sandboxes so first-time users can claim a warm
box immediately; the target reserve size defaults to 2. Convex stores durable
run state, active-run locking, progress events, and completion/failure status.

## Operations

Seed a manually created Browser Use profile for a phone number:

```bash
scripts/seed-browser-profile.ts +15551234567 browser-use-profile-id
```

Start a local Blaxel/Codex smoke run:

```bash
scripts/start-blaxel-codex-smoke.ts +15551234567 browser-use-profile-id
```

Deploy the app runtime. This builds the web app, pushes the Blaxel sandbox
image, then deploys Convex:

```bash
vpr deploy
```

Push only the Blaxel sandbox image:

```bash
vpr deploy:blaxel
```

Deploy only Convex changes:

```bash
vpr deploy:convex
```

## Notes

- One active Codex run is allowed per phone user sandbox.
- Additional messages queue behind the active run.
- `convex/crons.ts` keeps the Blaxel reserve sandbox pool at
  `BLAXEL_SANDBOX_RESERVE_TARGET`, defaulting to 2.
- Queued follow-up runs do not auto-drain yet after completion.
- Human approval still needs explicit product state before marketplace messages,
  offer acceptance, or logistics commitments.

More detail:

- `docs/blaxel-codex-browsercode-integration.md`
- `docs/agentphone-openai-voice-integration.md`
