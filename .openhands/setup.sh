#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

export XIAOBAI_WORKSPACE_ROOT="${XIAOBAI_WORKSPACE_ROOT:-$REPOSITORY_ROOT}"
export XIAONENG_ROOT="${XIAONENG_ROOT:-/opt/xiaoneng}"
export OBSIDIAN_VAULT_ROOT="${OBSIDIAN_VAULT_ROOT:-/memory/obsidian}"
export MEMORY_CONTAINER_VAULT_ROOT="${MEMORY_CONTAINER_VAULT_ROOT:-/memory/obsidian}"
export MEMORY_LEARNING_ROOT_NAME="${MEMORY_LEARNING_ROOT_NAME:-88-学习/xiaobai}"
export MEMORY_PROJECT_ID="${MEMORY_PROJECT_ID:-xbaiProjectCode}"

node "$REPOSITORY_ROOT/deploy/openhands/setup-workspace.mjs"
