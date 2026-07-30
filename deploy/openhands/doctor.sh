#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$SCRIPT_DIR/versions.lock"
ENV_FILE="$SCRIPT_DIR/.env"
FAILURES=0
WARNINGS=0

pass() {
  printf 'ok: %s\n' "$1"
}

fail() {
  printf 'fail: %s\n' "$1" >&2
  FAILURES=$((FAILURES + 1))
}

warn() {
  printf 'warn: %s\n' "$1" >&2
  WARNINGS=$((WARNINGS + 1))
}

if [ ! -f "$LOCK_FILE" ]; then
  fail "missing version lock: $LOCK_FILE"
else
  # shellcheck disable=SC1090
  source "$LOCK_FILE"
  case "${OPENHANDS_IMAGE:-}" in
    ''|*:latest) fail 'OpenHands image is missing or uses latest' ;;
    *) pass "OpenHands image is pinned: $OPENHANDS_IMAGE" ;;
  esac
fi

if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

if [ -n "${OPENHANDS_RUNTIME_ROOT:-}" ]; then
  RUNTIME_ROOT="$OPENHANDS_RUNTIME_ROOT"
elif [ -d "$BUNDLE_ROOT/artifacts" ]; then
  RUNTIME_ROOT="$BUNDLE_ROOT/runtime"
else
  RUNTIME_ROOT="$BUNDLE_ROOT/dist/openhands-runtime"
fi
COMPOSE_ENV="$RUNTIME_ROOT/compose.env"

if [ -f "$COMPOSE_ENV" ]; then
  # shellcheck disable=SC1090
  source "$COMPOSE_ENV"
  pass "runtime environment exists: $COMPOSE_ENV"
  RUNTIME_INITIALIZED=1
else
  warn "runtime has not been initialized: $COMPOSE_ENV"
  RUNTIME_INITIALIZED=0
  XIAOBAI_WORKSPACE_PATH="$BUNDLE_ROOT"
  DEFAULT_XIAONENG_SOURCE="$(cd "$BUNDLE_ROOT/.." 2>/dev/null && pwd)/xiaoneng"
  XIAONENG_WORKSPACE_PATH="${XIAONENG_SOURCE_PATH:-$DEFAULT_XIAONENG_SOURCE}"
  OBSIDIAN_VAULT_PATH="${OBSIDIAN_VAULT_PATH:-}"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  pass 'Docker and Compose v2 are available'
  DOCKER_AVAILABLE=1
else
  fail 'Docker and Compose v2 are required'
  DOCKER_AVAILABLE=0
fi

CONTAINER_ID=''
if [ "$DOCKER_AVAILABLE" -eq 1 ] && [ -f "$COMPOSE_ENV" ]; then
  CONTAINER_ID="$(docker compose --env-file "$COMPOSE_ENV" -f "$SCRIPT_DIR/compose.yaml" ps -q agent-canvas 2>/dev/null || true)"
fi

if [ -f "$SCRIPT_DIR/compose.yaml" ] && grep -Eq '\$\{XIAONENG_WORKSPACE_PATH[^}]*\}:/opt/xiaoneng:ro' "$SCRIPT_DIR/compose.yaml"; then
  pass 'Xiaoneng is configured as a read-only container mount'
else
  fail 'compose.yaml does not enforce /opt/xiaoneng:ro'
fi

if [ -d "$XIAOBAI_WORKSPACE_PATH/.git" ]; then
  if [ -w "$XIAOBAI_WORKSPACE_PATH" ]; then
    pass "Xiaobai workspace is writable: $XIAOBAI_WORKSPACE_PATH"
  else
    fail "Xiaobai workspace is not writable: $XIAOBAI_WORKSPACE_PATH"
  fi
  XIAOBAI_ACTUAL_COMMIT="$(git -C "$XIAOBAI_WORKSPACE_PATH" rev-parse HEAD 2>/dev/null || true)"
  if [ "${XIAOBAI_COMMIT:-SELF}" = 'SELF' ] || [ "$XIAOBAI_ACTUAL_COMMIT" = "${XIAOBAI_COMMIT:-}" ]; then
    pass "Xiaobai version matches: $XIAOBAI_ACTUAL_COMMIT"
  else
    fail "Xiaobai version mismatch: expected ${XIAOBAI_COMMIT:-unset}, got $XIAOBAI_ACTUAL_COMMIT"
  fi
else
  fail "Xiaobai workspace is missing: $XIAOBAI_WORKSPACE_PATH"
fi

if [ -d "$XIAONENG_WORKSPACE_PATH/.git" ]; then
  for required in xiaoneng-agent/SKILL.md harness/runtime/manifest.yaml; do
    if [ ! -f "$XIAONENG_WORKSPACE_PATH/$required" ]; then
      fail "Xiaoneng background is missing $required"
    fi
  done
  XIAONENG_ACTUAL_COMMIT="$(git -C "$XIAONENG_WORKSPACE_PATH" rev-parse HEAD 2>/dev/null || true)"
  if [ "$XIAONENG_ACTUAL_COMMIT" = "${XIAONENG_COMMIT:-}" ]; then
    pass "Xiaoneng version matches: $XIAONENG_ACTUAL_COMMIT"
  else
    fail "Xiaoneng version mismatch: expected ${XIAONENG_COMMIT:-unset}, got $XIAONENG_ACTUAL_COMMIT"
  fi
else
  fail "Xiaoneng background is missing: $XIAONENG_WORKSPACE_PATH"
fi

PROJECT_MAPPING="$XIAOBAI_WORKSPACE_PATH/workspace/projects/t-max/.loop/project.yaml"
if [ -f "$PROJECT_MAPPING" ] \
  && grep -Eq '^background:$' "$PROJECT_MAPPING" \
  && grep -Eq '^  id: xiaoneng$' "$PROJECT_MAPPING" \
  && grep -Eq '^  mount: ../../.local/t-max/mounts/background/xiaoneng$' "$PROJECT_MAPPING"; then
  pass 'T-MAX resolves to the Xiaoneng background'
else
  fail 'T-MAX project mapping does not resolve to Xiaoneng'
fi

LOCAL_CONFIG="$XIAOBAI_WORKSPACE_PATH/workspace/workspace.local.yaml"
if [ "$RUNTIME_INITIALIZED" -eq 1 ] && [ -f "$LOCAL_CONFIG" ]; then
  if grep -Eq '^memoryRoot: /memory/obsidian/88-学习/xiaobai/10-项目记忆/xbaiProjectCode$' "$LOCAL_CONFIG" \
    && grep -Eq '^memoryVaultRoot: /memory/obsidian$' "$LOCAL_CONFIG" \
    && ! grep -Eq '/Users/|file://' "$LOCAL_CONFIG"; then
    pass 'workspace.local.yaml uses container-only Obsidian paths'
  else
    fail 'workspace.local.yaml contains an unexpected or host-specific memory path'
  fi
elif [ "$RUNTIME_INITIALIZED" -eq 1 ]; then
  warn 'workspace.local.yaml is not generated until the first run'
else
  warn 'source-checkout workspace.local.yaml is machine-local and was not inspected'
fi

BACKGROUND_MOUNT="$XIAOBAI_WORKSPACE_PATH/workspace/.local/t-max/mounts/background/xiaoneng"
if [ "$RUNTIME_INITIALIZED" -eq 1 ] && [ -L "$BACKGROUND_MOUNT" ] && [ "$(readlink "$BACKGROUND_MOUNT")" = '/opt/xiaoneng' ]; then
  pass 'Xiaobai background entry points to /opt/xiaoneng'
elif [ "$RUNTIME_INITIALIZED" -eq 0 ]; then
  warn 'container background entry is not generated in the source checkout'
else
  fail 'Xiaobai background entry is missing or has the wrong target'
fi

if [ -n "$OBSIDIAN_VAULT_PATH" ]; then
  if [ -d "$OBSIDIAN_VAULT_PATH" ] && [ -w "$OBSIDIAN_VAULT_PATH" ]; then
    pass "Obsidian vault is writable: $OBSIDIAN_VAULT_PATH"
  else
    fail "Obsidian vault is missing or not writable: $OBSIDIAN_VAULT_PATH"
  fi
  WRITER_LOCK="$OBSIDIAN_VAULT_PATH/88-学习/xiaobai/10-项目记忆/xbaiProjectCode/.xiaobai-writer.lock"
  if [ -d "$WRITER_LOCK" ]; then
    if [ -n "$CONTAINER_ID" ]; then
      pass "memory writer lock belongs to the running Agent Canvas instance: $WRITER_LOCK"
    elif [ "$DOCKER_AVAILABLE" -eq 1 ] && [ -f "$COMPOSE_ENV" ]; then
      fail "stale memory writer lock exists while Agent Canvas is stopped: $WRITER_LOCK"
    else
      warn "memory writer lock exists but container state cannot be verified: $WRITER_LOCK"
    fi
  elif [ -n "$CONTAINER_ID" ]; then
    fail 'Agent Canvas is running without a memory writer lock'
  else
    warn 'memory writer lock is inactive because Agent Canvas is not running'
  fi
fi

scan_tracked_repository() {
  local label="$1"
  local repository="$2"
  local scope="${3:-full}"
  local matches

  [ -d "$repository/.git" ] || return 0
  matches="$(git -C "$repository" grep -nI -E \
    '(BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})' \
    -- . 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    fail "$label contains a credential-like tracked value"
  else
    pass "$label tracked files contain no recognized credential pattern"
  fi

  if [ "$scope" = 'xiaobai-distribution' ]; then
    matches="$(git -C "$repository" grep -nI -E '/Users/[A-Za-z0-9._-]+/' -- . \
      ':(exclude)workspace/memory/loops/**' \
      ':(exclude)workspace/memory/xiaoneng-page-preflight-2026-07-22.md' \
      2>/dev/null || true)"
  else
    matches="$(git -C "$repository" grep -nI -E '/Users/[A-Za-z0-9._-]+/' -- . 2>/dev/null || true)"
  fi
  if [ -n "$matches" ]; then
    fail "$label contains a tracked personal macOS path"
  else
    pass "$label tracked files contain no personal macOS path"
  fi

  matches="$(git -C "$repository" ls-files | grep -E '(^|/)\.ssh/' || true)"
  if [ -n "$matches" ]; then
    fail "$label contains tracked SSH configuration"
  else
    pass "$label contains no tracked SSH configuration"
  fi
}

if [ "${XIAOBAI_COMMIT:-SELF}" = 'SELF' ]; then
  scan_tracked_repository 'Xiaobai distribution scope' "$XIAOBAI_WORKSPACE_PATH" 'xiaobai-distribution'
else
  scan_tracked_repository 'Xiaobai' "$XIAOBAI_WORKSPACE_PATH"
fi
scan_tracked_repository 'Xiaoneng' "$XIAONENG_WORKSPACE_PATH"

if [ -f "$BUNDLE_ROOT/SHA256SUMS" ]; then
  if command -v shasum >/dev/null 2>&1; then
    CHECKSUM_OK="$(cd "$BUNDLE_ROOT" && shasum -a 256 -c SHA256SUMS >/dev/null 2>&1 && printf yes || printf no)"
  elif command -v sha256sum >/dev/null 2>&1; then
    CHECKSUM_OK="$(cd "$BUNDLE_ROOT" && sha256sum -c SHA256SUMS >/dev/null 2>&1 && printf yes || printf no)"
  else
    CHECKSUM_OK=no-tool
  fi
  if [ "$CHECKSUM_OK" = yes ]; then
    pass 'package SHA256SUMS is valid'
  elif [ "$CHECKSUM_OK" = no-tool ]; then
    fail 'package checksum requires shasum or sha256sum'
  else
    fail 'package SHA256SUMS validation failed'
  fi
fi

if [ "$DOCKER_AVAILABLE" -eq 1 ] && [ -f "$COMPOSE_ENV" ]; then
  if [ -n "$CONTAINER_ID" ]; then
    if docker compose --env-file "$COMPOSE_ENV" -f "$SCRIPT_DIR/compose.yaml" exec -T agent-canvas test ! -w /opt/xiaoneng; then
      pass 'running container confirms Xiaoneng is not writable'
    else
      fail 'running container can write to /opt/xiaoneng'
    fi
  else
    warn 'Agent Canvas is not running; live read-only verification was skipped'
  fi
fi

printf 'summary: failures=%s warnings=%s\n' "$FAILURES" "$WARNINGS"
if [ "$FAILURES" -ne 0 ]; then
  exit 1
fi
