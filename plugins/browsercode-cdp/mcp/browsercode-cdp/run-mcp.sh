#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
  bun install --cwd "$SCRIPT_DIR" --frozen-lockfile
fi

exec bun "$SCRIPT_DIR/browsercode-mcp.ts"
