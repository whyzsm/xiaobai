#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$SCRIPT_DIR/versions.lock"
ENV_FILE="$SCRIPT_DIR/.env"

if [ "${1:-}" = "--env" ]; then
  if [ -z "${2:-}" ]; then
    printf 'missing path after --env\n' >&2
    exit 2
  fi
  ENV_FILE="$2"
  shift 2
fi
if [ "$#" -ne 0 ]; then
  printf 'usage: %s [--env /path/to/.env]\n' "$0" >&2
  exit 2
fi

if [ ! -f "$LOCK_FILE" ]; then
  printf 'missing version lock: %s\n' "$LOCK_FILE" >&2
  exit 1
fi

# versions.lock and .env are trusted local configuration files.
# shellcheck disable=SC1090
source "$LOCK_FILE"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${LLM_API_KEY:?Set LLM_API_KEY in deploy/openhands/.env or the environment}"
: "${LLM_MODEL:?Set LLM_MODEL in deploy/openhands/.env or the environment}"

if ! command -v docker >/dev/null 2>&1; then
  printf 'Docker is required but was not found.\n' >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  printf 'Docker Compose v2 is required.\n' >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  printf 'Git is required but was not found.\n' >&2
  exit 1
fi

if [ ! -d "$BUNDLE_ROOT/artifacts" ] \
  && ! git -C "$BUNDLE_ROOT" cat-file -e HEAD:deploy/openhands/setup-workspace.mjs 2>/dev/null; then
  printf 'the OpenHands adapter is not committed in the source checkout\n' >&2
  printf 'commit the local OpenHands branch before creating or starting a distributable runtime\n' >&2
  exit 1
fi

if [ -n "${OPENHANDS_RUNTIME_ROOT:-}" ]; then
  RUNTIME_ROOT="$OPENHANDS_RUNTIME_ROOT"
elif [ -d "$BUNDLE_ROOT/artifacts" ]; then
  RUNTIME_ROOT="$BUNDLE_ROOT/runtime"
else
  RUNTIME_ROOT="$BUNDLE_ROOT/dist/openhands-runtime"
fi
mkdir -p "$RUNTIME_ROOT/projects" "$RUNTIME_ROOT/backgrounds" "$RUNTIME_ROOT/openhands-state"
RUNTIME_ROOT="$(cd "$RUNTIME_ROOT" && pwd)"

XIAOBAI_WORKSPACE_PATH="$RUNTIME_ROOT/projects/xiaobai"
XIAONENG_WORKSPACE_PATH="$RUNTIME_ROOT/backgrounds/xiaoneng"
OPENHANDS_STATE_PATH="$RUNTIME_ROOT/openhands-state"

if [ -z "${OBSIDIAN_VAULT_PATH:-}" ]; then
  OBSIDIAN_VAULT_PATH="$RUNTIME_ROOT/obsidian-vault"
fi
mkdir -p "$OBSIDIAN_VAULT_PATH"
OBSIDIAN_VAULT_PATH="$(cd "$OBSIDIAN_VAULT_PATH" && pwd)"

prepare_repository() {
  local label="$1"
  local target="$2"
  local bundle="$3"
  local source_repo="$4"
  local branch="$5"

  if [ -d "$target/.git" ]; then
    return 0
  fi
  if [ -e "$target" ]; then
    printf '%s target exists but is not a Git repository: %s\n' "$label" "$target" >&2
    exit 1
  fi

  if [ -f "$bundle" ]; then
    git clone --branch "$branch" "$bundle" "$target"
    return 0
  fi
  if [ -n "$source_repo" ] && [ -d "$source_repo/.git" ]; then
    git clone --branch "$branch" "$source_repo" "$target"
    return 0
  fi

  printf 'cannot initialize %s; missing bundle and source repository\n' "$label" >&2
  exit 1
}

XIAOBAI_SOURCE_PATH="$BUNDLE_ROOT"
DEFAULT_XIAONENG_SOURCE="$(cd "$BUNDLE_ROOT/.." 2>/dev/null && pwd)/xiaoneng"
XIAONENG_SOURCE_PATH="${XIAONENG_SOURCE_PATH:-$DEFAULT_XIAONENG_SOURCE}"

prepare_repository \
  'Xiaobai' \
  "$XIAOBAI_WORKSPACE_PATH" \
  "$BUNDLE_ROOT/artifacts/xiaobai.bundle" \
  "$XIAOBAI_SOURCE_PATH" \
  "$XIAOBAI_BRANCH"
prepare_repository \
  'Xiaoneng' \
  "$XIAONENG_WORKSPACE_PATH" \
  "$BUNDLE_ROOT/artifacts/xiaoneng.bundle" \
  "$XIAONENG_SOURCE_PATH" \
  "$XIAONENG_BRANCH"

if [ "$XIAOBAI_COMMIT" != 'SELF' ]; then
  ACTUAL_XIAOBAI_COMMIT="$(git -C "$XIAOBAI_WORKSPACE_PATH" rev-parse HEAD)"
  if [ "$ACTUAL_XIAOBAI_COMMIT" != "$XIAOBAI_COMMIT" ]; then
    printf 'Xiaobai version mismatch: expected %s, got %s\n' "$XIAOBAI_COMMIT" "$ACTUAL_XIAOBAI_COMMIT" >&2
    exit 1
  fi
fi
ACTUAL_XIAONENG_COMMIT="$(git -C "$XIAONENG_WORKSPACE_PATH" rev-parse HEAD)"
if [ "$ACTUAL_XIAONENG_COMMIT" != "$XIAONENG_COMMIT" ]; then
  printf 'Xiaoneng version mismatch: expected %s, got %s\n' "$XIAONENG_COMMIT" "$ACTUAL_XIAONENG_COMMIT" >&2
  exit 1
fi

COMPOSE_ENV="$RUNTIME_ROOT/compose.env"
cat >"$COMPOSE_ENV" <<EOF
OPENHANDS_IMAGE=$OPENHANDS_IMAGE
OPENHANDS_PORT=${OPENHANDS_PORT:-8000}
OPENHANDS_STATE_PATH=$OPENHANDS_STATE_PATH
XIAOBAI_WORKSPACE_PATH=$XIAOBAI_WORKSPACE_PATH
XIAONENG_WORKSPACE_PATH=$XIAONENG_WORKSPACE_PATH
OBSIDIAN_VAULT_PATH=$OBSIDIAN_VAULT_PATH
EOF

MEMORY_PROJECT_ROOT="$OBSIDIAN_VAULT_PATH/88-学习/xiaobai/10-项目记忆/xbaiProjectCode"
WRITER_LOCK="$MEMORY_PROJECT_ROOT/.xiaobai-writer.lock"
mkdir -p "$MEMORY_PROJECT_ROOT"
if ! mkdir "$WRITER_LOCK" 2>/dev/null; then
  printf 'memory writer lock already exists: %s\n' "$WRITER_LOCK" >&2
  printf 'stop the existing instance or remove a verified stale lock before retrying\n' >&2
  exit 1
fi

STARTED=0
cleanup_failed_start() {
  if [ "$STARTED" -ne 1 ]; then
    rm -f "$WRITER_LOCK/owner"
    rmdir "$WRITER_LOCK" 2>/dev/null || true
  fi
}
trap cleanup_failed_start EXIT INT TERM

cat >"$WRITER_LOCK/owner" <<EOF
bundleRoot=$BUNDLE_ROOT
runtimeRoot=$RUNTIME_ROOT
host=$(hostname)
startedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)
EOF

COMPOSE=(docker compose --env-file "$COMPOSE_ENV" -f "$SCRIPT_DIR/compose.yaml")
"${COMPOSE[@]}" --profile init run --rm workspace-init
"${COMPOSE[@]}" up -d agent-canvas

STARTED=1
printf 'OpenHands Agent Canvas started.\n'
printf 'UI: http://localhost:%s/canvas\n' "${OPENHANDS_PORT:-8000}"
printf 'Runtime: %s\n' "$RUNTIME_ROOT"
printf 'Memory: %s\n' "$MEMORY_PROJECT_ROOT"
