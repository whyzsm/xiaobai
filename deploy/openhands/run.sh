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
mkdir -p \
  "$RUNTIME_ROOT/workspaces" \
  "$RUNTIME_ROOT/backgrounds" \
  "$RUNTIME_ROOT/sources" \
  "$RUNTIME_ROOT/state/openhands" \
  "$RUNTIME_ROOT/state/control-plane"
RUNTIME_ROOT="$(cd "$RUNTIME_ROOT" && pwd)"

XIAOBAI_WORKSPACES_PATH="$RUNTIME_ROOT/workspaces"
XIAOBAI_BACKGROUNDS_PATH="$RUNTIME_ROOT/backgrounds"
XIAOBAI_WORKSPACE_PATH="$XIAOBAI_WORKSPACES_PATH/xiaobai"
XIAONENG_WORKSPACE_PATH="$RUNTIME_ROOT/backgrounds/xiaoneng"
OPENHANDS_SOURCE_CHECKOUT="$RUNTIME_ROOT/sources/openhands"
OPENHANDS_STATE_PATH="$RUNTIME_ROOT/state/openhands"
XIAOBAI_CONTROL_STATE_PATH="$RUNTIME_ROOT/state/control-plane"

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
DEFAULT_OPENHANDS_SOURCE="$(cd "$BUNDLE_ROOT/.." 2>/dev/null && pwd)/openHands"
OPENHANDS_SOURCE_PATH="${OPENHANDS_SOURCE_PATH:-$DEFAULT_OPENHANDS_SOURCE}"

if [ ! -d "$BUNDLE_ROOT/artifacts" ]; then
  if [ ! -d "$OPENHANDS_SOURCE_PATH/.git" ]; then
    printf 'customized OpenHands source is missing: %s\n' "$OPENHANDS_SOURCE_PATH" >&2
    exit 1
  fi
  OPENHANDS_DIRTY="$(git -C "$OPENHANDS_SOURCE_PATH" status --porcelain=v1 -uall)"
  if [ -n "$OPENHANDS_DIRTY" ]; then
    printf 'customized OpenHands source has uncommitted changes:\n%s\n' "$OPENHANDS_DIRTY" >&2
    printf 'commit the visual workspace implementation before starting the distributable runtime\n' >&2
    exit 1
  fi
fi

prepare_repository \
  'OpenHands' \
  "$OPENHANDS_SOURCE_CHECKOUT" \
  "$BUNDLE_ROOT/artifacts/openhands.bundle" \
  "$OPENHANDS_SOURCE_PATH" \
  "$OPENHANDS_BRANCH"
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

ACTUAL_OPENHANDS_COMMIT="$(git -C "$OPENHANDS_SOURCE_CHECKOUT" rev-parse HEAD)"
EXPECTED_OPENHANDS_COMMIT="$OPENHANDS_COMMIT"
if [ "$EXPECTED_OPENHANDS_COMMIT" = 'SELF' ]; then
  EXPECTED_OPENHANDS_COMMIT="$(git -C "$OPENHANDS_SOURCE_PATH" rev-parse HEAD)"
fi
if [ "$ACTUAL_OPENHANDS_COMMIT" != "$EXPECTED_OPENHANDS_COMMIT" ]; then
  printf 'OpenHands version mismatch: expected %s, got %s\n' "$EXPECTED_OPENHANDS_COMMIT" "$ACTUAL_OPENHANDS_COMMIT" >&2
  exit 1
fi
ACTUAL_XIAOBAI_COMMIT="$(git -C "$XIAOBAI_WORKSPACE_PATH" rev-parse HEAD)"
EXPECTED_XIAOBAI_COMMIT="$XIAOBAI_COMMIT"
if [ "$EXPECTED_XIAOBAI_COMMIT" = 'SELF' ]; then
  EXPECTED_XIAOBAI_COMMIT="$(git -C "$XIAOBAI_SOURCE_PATH" rev-parse HEAD)"
fi
if [ "$ACTUAL_XIAOBAI_COMMIT" != "$EXPECTED_XIAOBAI_COMMIT" ]; then
  printf 'Xiaobai version mismatch: expected %s, got %s\n' "$EXPECTED_XIAOBAI_COMMIT" "$ACTUAL_XIAOBAI_COMMIT" >&2
  exit 1
fi
ACTUAL_XIAONENG_COMMIT="$(git -C "$XIAONENG_WORKSPACE_PATH" rev-parse HEAD)"
if [ "$ACTUAL_XIAONENG_COMMIT" != "$XIAONENG_COMMIT" ]; then
  printf 'Xiaoneng version mismatch: expected %s, got %s\n' "$XIAONENG_COMMIT" "$ACTUAL_XIAONENG_COMMIT" >&2
  exit 1
fi

CONTROL_PLANE_PORT="${XIAOBAI_CONTROL_PLANE_PORT:-18002}"
OPENHANDS_IMAGE="${OPENHANDS_IMAGE_REPOSITORY}:${ACTUAL_OPENHANDS_COMMIT:0:12}-cp${CONTROL_PLANE_PORT}"
if ! docker image inspect "$OPENHANDS_IMAGE" >/dev/null 2>&1; then
  printf 'Building customized OpenHands image: %s\n' "$OPENHANDS_IMAGE"
  docker build \
    -f "$OPENHANDS_SOURCE_CHECKOUT/docker/Dockerfile" \
    --build-arg "AGENT_SERVER_IMAGE=$OPENHANDS_AGENT_SERVER_IMAGE" \
    --build-arg "AUTOMATION_VERSION=$OPENHANDS_AUTOMATION_VERSION" \
    --build-arg "AGENT_CANVAS_VERSION=$OPENHANDS_VERSION" \
    --build-arg "OPENHANDS_BUILD_GIT_SHA=$ACTUAL_OPENHANDS_COMMIT" \
    --build-arg "OPENHANDS_BUILD_GIT_REF=$OPENHANDS_BRANCH" \
    --build-arg "VITE_BASE_PATH=$OPENHANDS_CANVAS_BASE_PATH" \
    --build-arg "VITE_XIAOBAI_CONTROL_PLANE_URL=http://127.0.0.1:$CONTROL_PLANE_PORT" \
    --build-arg "VITE_XIAOBAI_RUNTIME_PATH_MODE=agent" \
    -t "$OPENHANDS_IMAGE" \
    "$OPENHANDS_SOURCE_CHECKOUT"
fi

COMPOSE_ENV="$RUNTIME_ROOT/compose.env"
cat >"$COMPOSE_ENV" <<EOF
OPENHANDS_IMAGE=$OPENHANDS_IMAGE
OPENHANDS_PORT=${OPENHANDS_PORT:-8000}
OPENHANDS_STATE_PATH=$OPENHANDS_STATE_PATH
OPENHANDS_SOURCE_CHECKOUT=$OPENHANDS_SOURCE_CHECKOUT
XIAOBAI_WORKSPACES_PATH=$XIAOBAI_WORKSPACES_PATH
XIAOBAI_BACKGROUNDS_PATH=$XIAOBAI_BACKGROUNDS_PATH
XIAOBAI_WORKSPACE_PATH=$XIAOBAI_WORKSPACE_PATH
XIAONENG_WORKSPACE_PATH=$XIAONENG_WORKSPACE_PATH
XIAOBAI_CONTROL_STATE_PATH=$XIAOBAI_CONTROL_STATE_PATH
XIAOBAI_CONTROL_PLANE_IMAGE=xiaobai/control-plane:${ACTUAL_XIAOBAI_COMMIT:0:12}
XIAOBAI_CONTROL_PLANE_PORT=$CONTROL_PLANE_PORT
XIAOBAI_ALLOWED_ORIGINS=http://127.0.0.1:${OPENHANDS_PORT:-8000},http://localhost:${OPENHANDS_PORT:-8000}
RUNTIME_UID=$(id -u)
RUNTIME_GID=$(id -g)
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
"${COMPOSE[@]}" up -d --build xiaobai-control-plane agent-canvas

STARTED=1
printf 'OpenHands Agent Canvas started.\n'
printf 'UI: http://localhost:%s/canvas\n' "${OPENHANDS_PORT:-8000}"
printf 'Control plane: http://127.0.0.1:%s\n' "$CONTROL_PLANE_PORT"
printf 'Runtime: %s\n' "$RUNTIME_ROOT"
printf 'Memory: %s\n' "$MEMORY_PROJECT_ROOT"
