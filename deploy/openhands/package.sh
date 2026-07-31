#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
XIAOBAI_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOCK_FILE="$SCRIPT_DIR/versions.lock"
XIAONENG_ROOT="${XIAONENG_SOURCE_PATH:-$(cd "$XIAOBAI_ROOT/.." && pwd)/xiaoneng}"
OPENHANDS_ROOT="${OPENHANDS_SOURCE_PATH:-$(cd "$XIAOBAI_ROOT/.." && pwd)/openHands}"
OUTPUT_ROOT="$XIAOBAI_ROOT/dist"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --xiaoneng)
      XIAONENG_ROOT="${2:?missing path after --xiaoneng}"
      shift 2
      ;;
    --openhands)
      OPENHANDS_ROOT="${2:?missing path after --openhands}"
      shift 2
      ;;
    --output)
      OUTPUT_ROOT="${2:?missing path after --output}"
      shift 2
      ;;
    --help)
      printf 'usage: %s [--openhands /path/to/openHands] [--xiaoneng /path/to/xiaoneng] [--output /path/to/dist]\n' "$0"
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
done

if [ ! -f "$LOCK_FILE" ]; then
  printf 'missing version lock: %s\n' "$LOCK_FILE" >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$LOCK_FILE"

checksum_file() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1"
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    printf 'missing SHA256 tool: install shasum or sha256sum\n' >&2
    return 1
  fi
}

require_clean_repository() {
  local label="$1"
  local repository="$2"
  local expected_branch="$3"
  local actual_branch
  local dirty

  if [ ! -d "$repository/.git" ]; then
    printf '%s is not a Git repository: %s\n' "$label" "$repository" >&2
    exit 1
  fi
  actual_branch="$(git -C "$repository" branch --show-current)"
  if [ "$actual_branch" != "$expected_branch" ]; then
    printf '%s branch mismatch: expected %s, got %s\n' "$label" "$expected_branch" "$actual_branch" >&2
    exit 1
  fi
  dirty="$(git -C "$repository" status --porcelain=v1 -uall)"
  if [ -n "$dirty" ]; then
    printf '%s has uncommitted changes; package only committed state:\n%s\n' "$label" "$dirty" >&2
    exit 1
  fi
}

scan_repository() {
  local label="$1"
  local repository="$2"
  local scan_personal_paths="${3:-yes}"
  local matches

  matches="$(git -C "$repository" grep -nI -E \
    '(BEGIN (RSA|OPENSSH|EC|PGP) PRIVATE KEY|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})' \
    -- . 2>/dev/null || true)"
  if [ -n "$matches" ]; then
    printf '%s contains a credential-like tracked value:\n%s\n' "$label" "$matches" >&2
    exit 1
  fi

  if [ "$scan_personal_paths" = 'yes' ]; then
    matches="$(git -C "$repository" grep -nI -E '/Users/[A-Za-z0-9._-]+/' -- . 2>/dev/null || true)"
    if [ -n "$matches" ]; then
      printf '%s contains a tracked personal macOS path:\n%s\n' "$label" "$matches" >&2
      exit 1
    fi
  fi

  matches="$(git -C "$repository" ls-files | grep -E '(^|/)\.ssh/' || true)"
  if [ -n "$matches" ]; then
    printf '%s contains tracked SSH configuration:\n%s\n' "$label" "$matches" >&2
    exit 1
  fi
}

require_clean_repository 'Xiaobai' "$XIAOBAI_ROOT" "$XIAOBAI_BRANCH"
require_clean_repository 'Xiaoneng' "$XIAONENG_ROOT" "$XIAONENG_BRANCH"
require_clean_repository 'OpenHands' "$OPENHANDS_ROOT" "$OPENHANDS_BRANCH"

XIAOBAI_COMMIT_RESOLVED="$(git -C "$XIAOBAI_ROOT" rev-parse HEAD)"
XIAONENG_COMMIT_RESOLVED="$(git -C "$XIAONENG_ROOT" rev-parse HEAD)"
OPENHANDS_COMMIT_RESOLVED="$(git -C "$OPENHANDS_ROOT" rev-parse HEAD)"
if [ "$XIAONENG_COMMIT_RESOLVED" != "$XIAONENG_SOURCE_COMMIT" ]; then
  printf 'Xiaoneng source lock is stale: expected %s, got %s\n' "$XIAONENG_SOURCE_COMMIT" "$XIAONENG_COMMIT_RESOLVED" >&2
  exit 1
fi
if [ "$OPENHANDS_SOURCE_COMMIT" != 'SELF' ] && [ "$OPENHANDS_COMMIT_RESOLVED" != "$OPENHANDS_SOURCE_COMMIT" ]; then
  printf 'OpenHands source lock is stale: expected %s, got %s\n' "$OPENHANDS_SOURCE_COMMIT" "$OPENHANDS_COMMIT_RESOLVED" >&2
  exit 1
fi

PACKAGE_FINGERPRINT="$(printf '%s\n%s\n%s\n' \
  "$OPENHANDS_COMMIT_RESOLVED" \
  "$XIAOBAI_COMMIT_RESOLVED" \
  "$XIAONENG_COMMIT_RESOLVED" \
  | git hash-object --stdin)"
PACKAGE_NAME="xiaobai-openhands-${PACKAGE_FINGERPRINT:0:12}"
OUTPUT_ROOT="$(mkdir -p "$OUTPUT_ROOT" && cd "$OUTPUT_ROOT" && pwd)"
FINAL_DIR="$OUTPUT_ROOT/$PACKAGE_NAME"
FINAL_ARCHIVE="$OUTPUT_ROOT/$PACKAGE_NAME.tar.gz"
if [ -e "$FINAL_DIR" ] || [ -e "$FINAL_ARCHIVE" ]; then
  printf 'package output already exists: %s\n' "$PACKAGE_NAME" >&2
  exit 1
fi

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/xiaobai-openhands.XXXXXX")"
cleanup() {
  if [ -n "${TEMP_ROOT:-}" ] && [ -d "$TEMP_ROOT" ]; then
    rm -rf -- "$TEMP_ROOT"
  fi
}
trap cleanup EXIT INT TERM

STAGING="$TEMP_ROOT/$PACKAGE_NAME"
SNAPSHOTS="$TEMP_ROOT/snapshots"
mkdir -p "$STAGING/artifacts" "$STAGING/deploy" "$SNAPSHOTS"
git -C "$XIAOBAI_ROOT" archive HEAD deploy/openhands | tar -x -C "$STAGING"

create_snapshot_repository() {
  local label="$1"
  local source_repo="$2"
  local branch="$3"
  local source_commit="$4"
  local target_repo="$5"
  local source_date

  mkdir -p "$target_repo"
  if [ "$label" = 'Xiaobai' ]; then
    git -C "$source_repo" archive HEAD -- . \
      ':(exclude)workspace/memory/loops/**' \
      ':(exclude)workspace/memory/xiaoneng-page-preflight-2026-07-22.md' \
      | tar -x -C "$target_repo"
  else
    git -C "$source_repo" archive HEAD | tar -x -C "$target_repo"
  fi

  git -C "$target_repo" init -b "$branch" >/dev/null
  git -C "$target_repo" add -A
  source_date="$(git -C "$source_repo" show -s --format=%aI "$source_commit")"
  GIT_AUTHOR_DATE="$source_date" GIT_COMMITTER_DATE="$source_date" git -C "$target_repo" \
    -c user.name='Xiaobai OpenHands Packager' \
    -c user.email='openhands-package@example.invalid' \
    commit -m "snapshot: $label $source_commit" >/dev/null
}

XIAOBAI_SNAPSHOT="$SNAPSHOTS/xiaobai"
XIAONENG_SNAPSHOT="$SNAPSHOTS/xiaoneng"
OPENHANDS_SNAPSHOT="$SNAPSHOTS/openhands"
create_snapshot_repository 'Xiaobai' "$XIAOBAI_ROOT" "$XIAOBAI_BRANCH" "$XIAOBAI_COMMIT_RESOLVED" "$XIAOBAI_SNAPSHOT"
create_snapshot_repository 'Xiaoneng' "$XIAONENG_ROOT" "$XIAONENG_BRANCH" "$XIAONENG_COMMIT_RESOLVED" "$XIAONENG_SNAPSHOT"
create_snapshot_repository 'OpenHands' "$OPENHANDS_ROOT" "$OPENHANDS_BRANCH" "$OPENHANDS_COMMIT_RESOLVED" "$OPENHANDS_SNAPSHOT"
scan_repository 'Xiaobai snapshot' "$XIAOBAI_SNAPSHOT"
scan_repository 'Xiaoneng snapshot' "$XIAONENG_SNAPSHOT"
scan_repository 'OpenHands snapshot' "$OPENHANDS_SNAPSHOT" no

XIAOBAI_SNAPSHOT_COMMIT="$(git -C "$XIAOBAI_SNAPSHOT" rev-parse HEAD)"
XIAONENG_SNAPSHOT_COMMIT="$(git -C "$XIAONENG_SNAPSHOT" rev-parse HEAD)"
OPENHANDS_SNAPSHOT_COMMIT="$(git -C "$OPENHANDS_SNAPSHOT" rev-parse HEAD)"
git -C "$XIAOBAI_SNAPSHOT" bundle create "$STAGING/artifacts/xiaobai.bundle" "$XIAOBAI_BRANCH"
git -C "$XIAONENG_SNAPSHOT" bundle create "$STAGING/artifacts/xiaoneng.bundle" "$XIAONENG_BRANCH"
git -C "$OPENHANDS_SNAPSHOT" bundle create "$STAGING/artifacts/openhands.bundle" "$OPENHANDS_BRANCH"
git bundle verify "$STAGING/artifacts/xiaobai.bundle" >/dev/null
git bundle verify "$STAGING/artifacts/xiaoneng.bundle" >/dev/null
git bundle verify "$STAGING/artifacts/openhands.bundle" >/dev/null

cat >"$STAGING/deploy/openhands/versions.lock" <<EOF
# Resolved by deploy/openhands/package.sh. Contains no credentials or machine paths.
# 由 deploy/openhands/package.sh 解析，不包含凭据或本机路径。
OPENHANDS_VERSION=$OPENHANDS_VERSION
OPENHANDS_BRANCH=$OPENHANDS_BRANCH
OPENHANDS_IMAGE_REPOSITORY=$OPENHANDS_IMAGE_REPOSITORY
OPENHANDS_SOURCE_COMMIT=$OPENHANDS_COMMIT_RESOLVED
OPENHANDS_COMMIT=$OPENHANDS_SNAPSHOT_COMMIT
OPENHANDS_AGENT_SERVER_IMAGE=$OPENHANDS_AGENT_SERVER_IMAGE
OPENHANDS_AUTOMATION_VERSION=$OPENHANDS_AUTOMATION_VERSION
OPENHANDS_CANVAS_BASE_PATH=$OPENHANDS_CANVAS_BASE_PATH
XIAOBAI_BRANCH=$XIAOBAI_BRANCH
XIAOBAI_SOURCE_COMMIT=$XIAOBAI_COMMIT_RESOLVED
XIAOBAI_COMMIT=$XIAOBAI_SNAPSHOT_COMMIT
XIAONENG_BRANCH=$XIAONENG_BRANCH
XIAONENG_SOURCE_COMMIT=$XIAONENG_COMMIT_RESOLVED
XIAONENG_COMMIT=$XIAONENG_SNAPSHOT_COMMIT
EOF

(
  cd "$STAGING"
  find . -type f ! -name SHA256SUMS | LC_ALL=C sort | while IFS= read -r file; do
    checksum_file "$file"
  done >SHA256SUMS
)

mv "$STAGING" "$FINAL_DIR"
tar -czf "$FINAL_ARCHIVE" -C "$OUTPUT_ROOT" "$PACKAGE_NAME"

printf 'package-directory: %s\n' "$FINAL_DIR"
printf 'package-archive: %s\n' "$FINAL_ARCHIVE"
printf 'xiaobai-source: %s (%s)\n' "$XIAOBAI_COMMIT_RESOLVED" "$XIAOBAI_BRANCH"
printf 'xiaobai-snapshot: %s\n' "$XIAOBAI_SNAPSHOT_COMMIT"
printf 'xiaoneng-source: %s (%s)\n' "$XIAONENG_COMMIT_RESOLVED" "$XIAONENG_BRANCH"
printf 'xiaoneng-snapshot: %s\n' "$XIAONENG_SNAPSHOT_COMMIT"
printf 'openhands-source: %s (%s)\n' "$OPENHANDS_COMMIT_RESOLVED" "$OPENHANDS_BRANCH"
printf 'openhands-snapshot: %s\n' "$OPENHANDS_SNAPSHOT_COMMIT"
