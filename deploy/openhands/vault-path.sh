#!/usr/bin/env bash

is_obsidian_vault_root() {
  local vault_path="${1%/}"
  case "$vault_path" in
    ''|88-学习|88-学习/*|*/88-学习|*/88-学习/*) return 1 ;;
    *) return 0 ;;
  esac
}
