# Loop Memory / Loop 记忆

## 中文

这个目录是 loop 运行的默认 memory root。

每台电脑也可以通过 `workspace/workspace.local.yaml` 把 memory 重定向到其他位置。推荐指向 Obsidian 中的项目独立目录：

```yaml
memoryRoot: /absolute/path/to/ObsidianVault/88-学习/10-项目记忆/xbaiProjectCode
```

`workspace.local.yaml` 已被 git 忽略。这样工程仓保持干净，同时不同终端或不同电脑可以指向同一个同步的 Obsidian vault 项目目录。

## 当前结构

- `loops/<loop-id>/state.md`：人可读的 loop 状态，适合在 Obsidian 中编辑。
- `loops/<loop-id>/inbox.md`：人工决策和后续事项，适合在 Obsidian 中编辑。
- `loops/<loop-id>/decisions.md`：长期决策记录，适合在 Obsidian 中编辑。
- `loops/<loop-id>/runs.jsonl`：追加式运行日志，通常由工具写入。
- `loops/<loop-id>/findings.jsonl`：追加式发现项日志，通常由工具写入。
- `loops/<loop-id>/metrics.jsonl`：追加式指标日志，通常由工具写入。

## Obsidian 使用建议

推荐 Obsidian 布局：

```text
[vault]/88-学习/
  00-记忆索引/
    memory-index.json
    projects.md
    cases.md
    patterns.md
    tags.md
  10-项目记忆/
    xbaiProjectCode/
      index.md
      project-profile.md
      active-context.md
      decisions.md
      inbox.md
      loops/
        morning-triage/
          state.md
          inbox.md
          decisions.md
          runs.jsonl
          findings.jsonl
          metrics.jsonl
      cases/
      patterns/
      reports/
```

优先用 Obsidian 管理 Markdown 文件：`index.md`、`project-profile.md`、`active-context.md`、`state.md`、`inbox.md`、`decisions.md`。

JSONL 文件保留为机器可读日志。Obsidian 可以展示它们，但不建议手工编辑，因为每一行都必须保持合法 JSON。

常用命令：

```bash
npm run loop -- memory init --project xbaiProjectCode --write --json
npm run loop -- memory index --write --json
npm run loop -- memory validate --json
npm run loop -- memory search "Loop Engineering" --json
npm run loop -- memory context --loop morning-triage --json
```

## English

This directory is the default memory root for loop runs.

Memory can also be redirected per computer with `workspace/workspace.local.yaml`. Prefer an isolated project directory inside Obsidian:

```yaml
memoryRoot: /absolute/path/to/ObsidianVault/88-学习/10-项目记忆/xbaiProjectCode
```

`workspace.local.yaml` is ignored by git. This keeps the shared engineering repo clean while allowing each terminal or computer to point at the same synced Obsidian vault directory.

## Current Layout

- `loops/<loop-id>/state.md`: human-readable loop state, safe to edit in Obsidian.
- `loops/<loop-id>/inbox.md`: human decisions and follow-ups, safe to edit in Obsidian.
- `loops/<loop-id>/decisions.md`: durable decisions, safe to edit in Obsidian.
- `loops/<loop-id>/runs.jsonl`: append-only run log, normally edited by tools.
- `loops/<loop-id>/findings.jsonl`: append-only findings log, normally edited by tools.
- `loops/<loop-id>/metrics.jsonl`: append-only metrics log, normally edited by tools.

## Obsidian Guidance

Use Obsidian for Markdown first: `index.md`, `project-profile.md`, `active-context.md`, `state.md`, `inbox.md`, and `decisions.md`.

Keep JSONL files as machine-readable logs. Obsidian can display them, but manual edits should be rare because each line must remain valid JSON.

Recommended vault layout:

```text
[vault]/88-学习/
  00-记忆索引/
    memory-index.json
  10-项目记忆/
    xbaiProjectCode/
      index.md
      project-profile.md
      active-context.md
      loops/<loop-id>/
      cases/
      patterns/
```
