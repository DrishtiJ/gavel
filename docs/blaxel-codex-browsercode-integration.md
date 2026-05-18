# Blaxel Codex + BrowserCode Runtime

This is the proposed runtime shape for giving each Gavel user a durable remote
computer that can run Codex with the BrowserCode plugin installed.

## Goal

Each user gets one Blaxel sandbox named from their stable app identity. The
sandbox runs Codex in a controlled project workspace, with the BrowserCode MCP
plugin available as `browser_execute`. Browser Use profiles stay outside the
sandbox and are selected per user through `BROWSER_USE_PROFILE_ID`.

The sandbox is reused across that user's agent runs so filesystem state,
installed packages, Codex session files, and BrowserCode `.bcode` workspace
state survive standby. Blaxel handles scale-to-zero when the sandbox is idle.

## Why Sandboxes

Blaxel sandboxes are the right primitive here because they provide:

- a per-user VM boundary for the Codex agent process
- process execution and logs through the Blaxel API
- a writable filesystem that snapshots into standby
- custom images for preinstalling Codex, Bun, and BrowserCode
- `createIfNotExists` so the app can reconnect to the same user machine
- `ttl-idle` deletion when abandoned user machines should be cleaned up

Do not use a Blaxel hosted agent as the primary isolation boundary for the MVP.
We want Codex itself to run inside the user's sandbox, and the app should manage
that sandbox lifecycle explicitly.

## Runtime Image

Create a custom Blaxel sandbox image, for example
`gavel-codex-browsercode`, containing:

- Node.js and Bun
- Git, curl, bash, ca-certificates, and build tools
- the Codex CLI
- the repo's `plugins/browsercode` directory
- a generated `/home/codex/.codex/config.toml` that registers BrowserCode:

```toml
[mcp_servers.browsercode]
command = "/opt/gavel/plugins/browsercode/mcp/browsercode/run-mcp.sh"
args = []
env_vars = ["BROWSER_USE_API_KEY", "BROWSER_USE_PROFILE_ID", "BU_CDP_WS", "BU_CDP_URL"]
```

The Dockerfile must include Blaxel's `sandbox-api` binary and the entrypoint
must start it. BrowserCode should remain vendored from this repo rather than
rewritten for Blaxel.

## Per-User State

Store these records in Convex:

- `browserProfiles`
  - `ownerTokenIdentifier`
  - `browserUseProfileId`
  - `createdAt`
  - `updatedAt`
- `agentSandboxes`
  - `ownerTokenIdentifier`
  - `sandboxName`
  - `region`
  - `image`
  - `status`
  - `lastStartedAt`
  - `lastSeenAt`
- `agentRuns`
  - `ownerTokenIdentifier`
  - `sandboxName`
  - `prompt`
  - `status`
  - `confirmationState`
  - `createdAt`
  - `updatedAt`
- `agentRunEvents`
  - `runId`
  - `sequence`
  - `type`
  - `message`
  - `createdAt`

Use `ctx.auth.getUserIdentity()` and store `identity.tokenIdentifier` as the
owner key. Do not accept user IDs from the client for sandbox ownership.

## Sandbox Naming

Derive the sandbox name from the authenticated user's stable owner key:

```ts
gavel-user-${sha256(identity.tokenIdentifier).slice(0, 24)}
```

The name must be deterministic so `SandboxInstance.createIfNotExists` can
reconnect to the same user sandbox. Keep the raw token identifier out of Blaxel
resource names and labels.

## Sandbox Creation

The app-side orchestration should call the Blaxel TypeScript SDK from a server
environment with `BL_WORKSPACE`, `BL_API_KEY`, and preferably `BL_REGION` set.

```ts
import { SandboxInstance } from '@blaxel/core'

export async function ensureUserSandbox(input: {
  sandboxName: string
  browserUseProfileId: string
}) {
  return await SandboxInstance.createIfNotExists({
    name: input.sandboxName,
    image: process.env.BLAXEL_CODEX_BROWSERCODE_IMAGE!,
    memory: 8192,
    region: process.env.BL_REGION ?? 'us-pdx-1',
    labels: {
      app: 'gavel',
      runtime: 'codex-browsercode',
    },
    lifecycle: {
      expirationPolicies: [
        { type: 'ttl-idle', value: '24h', action: 'delete' },
      ],
    },
    envs: [
      {
        name: 'BROWSER_USE_API_KEY',
        value: process.env.BROWSER_USE_API_KEY!,
      },
      {
        name: 'BROWSER_USE_PROFILE_ID',
        value: input.browserUseProfileId,
      },
    ],
  })
}
```

Blaxel currently requires environment variables at sandbox creation time; do not
assume they can be patched later. If a user's Browser Use profile changes, create
a replacement sandbox or design the runner to read the profile ID from a job
file instead of process environment.

## Running Codex

For each user message:

1. Convex creates an `agentRuns` row in `queued`.
2. The server orchestrator ensures the user sandbox exists.
3. The orchestrator writes a job file into the sandbox, for example
   `/workspace/gavel-runs/<runId>/prompt.md`.
4. The orchestrator starts Codex in the sandbox:

```bash
codex exec \
  --json \
  --cd /workspace/gavel \
  --sandbox danger-full-access \
  --ask-for-approval never \
  "Run the Gavel selling task described in /workspace/gavel-runs/<runId>/prompt.md"
```

5. The orchestrator tails JSONL events and writes user-visible progress into
   `agentRunEvents`.
6. When the agent reaches the final confirmation checkpoint, it writes a proposed
   action summary; the app asks the user once.
7. On approval, the orchestrator resumes or starts a follow-up Codex run in the
   same sandbox.

Use one active Codex run per sandbox at a time. Queue additional work per user in
Convex to avoid two agents fighting over the same browser profile and filesystem.

## BrowserCode Behavior

Inside the sandbox, Codex sees the same BrowserCode MCP tool:

- tool name: `browser_execute`
- skill: `browser-execute`
- Browser Use cloud connection path remains inside the vendored BrowserCode
  runtime
- screenshots return through MCP image content
- `.bcode/agent-workspace` lives under Codex's project root

The preferred Browser Use path for this product is not a local Chrome process.
Codex should open Browser Use cloud browsers with the user's
`BROWSER_USE_PROFILE_ID`, drive the task, then explicitly stop the cloud browser
so the profile is saved and paid browser time ends.

Do not use Browser Use hosted Agent Sessions, Browser Use Agency, Browser Use
tasks, or any Browser Use autonomous agent product. Browser Use is only the
remote browser provider here; Codex is the sole agent and controls the browser
through BrowserCode/CDP.

## First Implementation Slice

1. Add `@blaxel/core`.
2. Add Convex tables for browser profiles, sandboxes, runs, and run events.
3. Add a server-only sandbox orchestrator module.
4. Add a custom Blaxel sandbox image under `blaxel/codex-browsercode`.
5. Deploy the image with `bl push` or `bl deploy`.
6. Add a test route or script that creates the current user's sandbox and runs a
   one-line Codex task that calls `browser_execute` against Browser Use cloud.

## Open Decisions

- Whether the long-running orchestrator should live in TanStack Start server code,
  a Convex action, or a separate Blaxel-hosted service.
- Whether to keep each user's sandbox indefinitely in standby or delete after an
  idle TTL such as `24h`.
- Whether Browser Use profile IDs should be sandbox environment variables or
  per-run job file inputs. Per-run inputs make profile changes easier.
- Whether Codex auth should use an API key in the sandbox or a service account
  style `CODEX_HOME` baked at runtime.
