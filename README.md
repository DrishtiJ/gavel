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
Configure AgentPhone to deliver inbound messages to:

```text
POST /api/agentphone/webhook
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
