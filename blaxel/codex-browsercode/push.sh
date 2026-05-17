#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
CONTEXT_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "$CONTEXT_DIR"
}
trap cleanup EXIT

mkdir -p "$CONTEXT_DIR/blaxel/codex-browsercode" "$CONTEXT_DIR/plugins"
cp "$SCRIPT_DIR/Dockerfile" "$CONTEXT_DIR/Dockerfile"
cp "$SCRIPT_DIR/blaxel.toml" "$CONTEXT_DIR/blaxel.toml"
cp "$SCRIPT_DIR/entrypoint.sh" "$CONTEXT_DIR/blaxel/codex-browsercode/entrypoint.sh"
cp "$SCRIPT_DIR/codex-config.toml" "$CONTEXT_DIR/blaxel/codex-browsercode/codex-config.toml"
cp -R "$REPO_ROOT/plugins/browsercode" "$CONTEXT_DIR/plugins/browsercode"

cd "$CONTEXT_DIR"
bl push --name gavel-codex-browsercode --type sandbox -y
