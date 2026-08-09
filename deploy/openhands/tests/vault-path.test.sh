#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../vault-path.sh
source "$SCRIPT_DIR/../vault-path.sh"

valid_paths=(
  '/tmp/obsidian-vault'
  '/tmp/88-学习资料'
  'relative-vault'
)

invalid_paths=(
  '88-学习'
  '/tmp/obsidian-vault/88-学习'
  '/tmp/obsidian-vault/88-学习/'
  '/tmp/obsidian-vault/88-学习/xiaobai'
  '/tmp/obsidian-vault/88-学习/xiaobai/10-项目记忆/xbaiProjectCode'
)

for vault_path in "${valid_paths[@]}"; do
  if ! is_obsidian_vault_root "$vault_path"; then
    printf 'expected valid Vault root: %s\n' "$vault_path" >&2
    exit 1
  fi
done

for vault_path in "${invalid_paths[@]}"; do
  if is_obsidian_vault_root "$vault_path"; then
    printf 'expected path inside 88-学习 to be rejected: %s\n' "$vault_path" >&2
    exit 1
  fi
done

test_root="$(mktemp -d "${TMPDIR:-/tmp}/xiaobai-vault-path.XXXXXX")"
trap 'rm -rf -- "$test_root"' EXIT
invalid_vault="$test_root/obsidian-vault/88-学习"
run_output="$test_root/run-output.log"
if OBSIDIAN_VAULT_PATH="$invalid_vault" \
  OPENHANDS_RUNTIME_ROOT="$test_root/runtime" \
  bash "$SCRIPT_DIR/../run.sh" >"$run_output" 2>&1; then
  printf 'run.sh accepted an invalid Vault root\n' >&2
  exit 1
fi
if ! grep -Fq 'must point to the directory above 88-学习' "$run_output"; then
  printf 'run.sh did not report the invalid Vault root\n' >&2
  exit 1
fi
if [ -e "$invalid_vault" ] || [ -e "$test_root/runtime" ]; then
  printf 'run.sh created runtime directories before validating the Vault root\n' >&2
  exit 1
fi

printf 'vault path validation tests passed\n'
