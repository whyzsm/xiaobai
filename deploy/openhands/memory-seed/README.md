# Empty Memory Seed / 空记忆种子

## 中文

这个目录只保存可分发的空记忆模板。`setup-workspace.mjs` 首次启动时把 `project/` 中缺失的文件复制到接收方 Obsidian Vault，但不会覆盖已有内容。

这里禁止保存真实任务的 `runs.jsonl`、`findings.jsonl`、`metrics.jsonl`、个人路径、凭据或未脱敏业务记录。运行时会在接收方 Vault 中创建空 JSONL 文件。

## English

This directory contains only distributable empty-memory templates. On first start, `setup-workspace.mjs` copies missing files from `project/` into the recipient's Obsidian vault without overwriting existing content.

Do not store real-task `runs.jsonl`, `findings.jsonl`, `metrics.jsonl`, personal paths, credentials, or unsanitized business records here. Empty JSONL files are created in the recipient's vault at runtime.
