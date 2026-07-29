#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [ -n "${OPENHANDS_RUNTIME_ROOT:-}" ]; then
  RUNTIME_ROOT="$OPENHANDS_RUNTIME_ROOT"
elif [ -d "$BUNDLE_ROOT/artifacts" ]; then
  RUNTIME_ROOT="$BUNDLE_ROOT/runtime"
else
  RUNTIME_ROOT="$BUNDLE_ROOT/dist/openhands-runtime"
fi
COMPOSE_ENV="$RUNTIME_ROOT/compose.env"

if [ ! -f "$COMPOSE_ENV" ]; then
  printf 'missing runtime compose environment: %s\n' "$COMPOSE_ENV" >&2
  exit 1
fi

# compose.env contains generated local paths only, never model credentials.
# shellcheck disable=SC1090
source "$COMPOSE_ENV"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose --env-file "$COMPOSE_ENV" -f "$SCRIPT_DIR/compose.yaml" down
else
  printf 'Docker is unavailable; the writer lock was preserved because container state cannot be verified.\n' >&2
  exit 1
fi

WRITER_LOCK="$OBSIDIAN_VAULT_PATH/88-学习/xiaobai/10-项目记忆/xbaiProjectCode/.xiaobai-writer.lock"
if [ -d "$WRITER_LOCK" ]; then
  rm -f "$WRITER_LOCK/owner"
  if ! rmdir "$WRITER_LOCK"; then
    printf 'writer lock contains unexpected files and was preserved: %s\n' "$WRITER_LOCK" >&2
    exit 1
  fi
fi

printf 'OpenHands Agent Canvas stopped.\n'
printf 'Memory preserved at: %s\n' "$OBSIDIAN_VAULT_PATH"
