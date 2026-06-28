# Obsidian Memory Migration Guide

## Goal

Move existing `workspace/memory` files into an Obsidian project memory directory while keeping the repository clean and preserving machine-readable logs.

## Target Layout

```text
[vault]/88-学习/
  00-记忆索引/
  10-项目记忆/
    <projectId>/
      index.md
      project-profile.md
      active-context.md
      decisions.md
      inbox.md
      loops/
        <loopId>/
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

## Steps

1. Confirm the Obsidian vault root. It is the directory that contains `.obsidian/`.

2. Configure this workspace:

```yaml
# workspace/workspace.local.yaml
memoryRoot: /path/to/ObsidianVault/88-学习/10-项目记忆/<projectId>
```

3. Initialize missing project memory files:

```bash
npm run loop -- memory init --project <projectId> --write --json
```

4. Copy existing loop files:

```bash
mkdir -p /path/to/ObsidianVault/88-学习/10-项目记忆/<projectId>/loops/<loopId>
cp -p workspace/memory/loops/<loopId>/* /path/to/ObsidianVault/88-学习/10-项目记忆/<projectId>/loops/<loopId>/
```

5. Generate the index:

```bash
npm run loop -- memory index --write --json
```

Expected output:

```json
{
  "ok": true,
  "command": "memory index",
  "preview": false
}
```

6. Validate:

```bash
npm run loop -- memory validate --json
```

Expected output:

```json
{
  "ok": true,
  "errors": []
}
```

7. Verify context loading:

```bash
npm run loop -- memory context --loop <loopId> --json
```

## Rollback

1. Restore `workspace/workspace.local.yaml` to:

```yaml
memoryRoot: memory
```

2. Rerun:

```bash
npm run validate
npm run dry-run
```

3. Do not delete Obsidian files during rollback. Archive or move them manually after validation.

## Manual Editing Rules

- Safe to edit in Obsidian: `index.md`, `project-profile.md`, `active-context.md`, `decisions.md`, `inbox.md`, loop `state.md`, loop `inbox.md`.
- Avoid manual edits: `runs.jsonl`, `findings.jsonl`, `metrics.jsonl`.
- Regenerable: `00-记忆索引/memory-index.json`.

## Recovery

If the index is stale or missing:

```bash
npm run loop -- memory index --write --json
```

If JSONL validation fails, edit only the reported line and rerun:

```bash
npm run loop -- memory validate --json
```
