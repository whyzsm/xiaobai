# T-MAX Project Group Skill / T-MAX 项目组技能

## 中文

## 目标

在当前 loop workspace 中持久化 T-MAX 项目背景，并把一个共享背景绑定到多个本地代码仓。

## 背景

- Shared background mount: `../../.local/t-max/mounts/background/shared-skills`
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.
- The shared background applies to every repository listed in `.loop/project.yaml`.

## 已挂载代码仓

- `KPIUI`: `../../.local/t-max/mounts/repos/KPIUI`
- `max-console-ui`: `../../.local/t-max/mounts/repos/max-console-ui`
- `max-operate-monitor-ui`: `../../.local/t-max/mounts/repos/max-operate-monitor-ui`
- `operateBusiness`: `../../.local/t-max/mounts/repos/operateBusiness`
- `operateSupport`: `../../.local/t-max/mounts/repos/operateSupport`
- `dcm`: `../../.local/t-max/mounts/repos/dcm`
- `scan`: `../../.local/t-max/mounts/repos/scan`

## 规则

1. 修改任何 T-MAX 挂载仓库前，先读取 `workspace/.local/t-max/mounts/background/shared-skills`。
2. 即使这些仓库共享同一份项目背景，也要把它们视为彼此独立的 git worktree。
3. 在 KPIUI、max-console-ui、max-operate-monitor-ui、operateBusiness、operateSupport、dcm、scan 中一致应用 shared-skills 指导。
4. 如果挂载缺失或失效，先运行 `npm run mount:tmax` 刷新挂载。
5. 仓库特定修改只能落在 `workspace/.local/t-max/mounts/repos/` 下选中的本地挂载仓。
6. 修改前检查目标仓库当前分支；不要假设所有 T-MAX 仓库使用相同默认分支。
7. frontend-delivery loop 必须先生成主设计文档和各仓补充分设计文档，通过独立设计评审并获得 `human-design-approval` 后，才允许进入编码。
8. 业务设计正文和业务代码只能落在当前参与开发的挂载目标仓；工程仓只记录状态、门禁结果、源链接、目标仓和 PR 链接。

## English

## Purpose

Persist the T-MAX project background in this loop workspace and bind one shared background to multiple local code repositories.

## Background

- Shared background mount: `../../.local/t-max/mounts/background/shared-skills`
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.
- The shared background applies to every repository listed in `.loop/project.yaml`.

## Mounted Repositories

- `KPIUI`: `../../.local/t-max/mounts/repos/KPIUI`
- `max-console-ui`: `../../.local/t-max/mounts/repos/max-console-ui`
- `max-operate-monitor-ui`: `../../.local/t-max/mounts/repos/max-operate-monitor-ui`
- `operateBusiness`: `../../.local/t-max/mounts/repos/operateBusiness`
- `operateSupport`: `../../.local/t-max/mounts/repos/operateSupport`
- `dcm`: `../../.local/t-max/mounts/repos/dcm`
- `scan`: `../../.local/t-max/mounts/repos/scan`

## Rules

1. Load `workspace/.local/t-max/mounts/background/shared-skills` before making changes in any mounted T-MAX repository.
2. Treat the repositories as separate git worktrees even though they share the same project background.
3. Apply shared-skills guidance consistently across KPIUI, max-console-ui, max-operate-monitor-ui, operateBusiness, operateSupport, dcm, and scan.
4. Refresh missing or broken mounts with `npm run mount:tmax` before editing.
5. Keep repository-specific changes inside the selected local mount under `workspace/.local/t-max/mounts/repos/`.
6. Check each repository's current branch before editing; do not assume all T-MAX repositories use the same default branch.
7. The frontend-delivery loop must create the master design document and repository supplements, pass independent design review, and record `human-design-approval` before implementation.
8. Business design bodies and business code belong only in participating mounted target repositories. The engineering repository records only state, gate results, source links, target repositories, and PR links.
