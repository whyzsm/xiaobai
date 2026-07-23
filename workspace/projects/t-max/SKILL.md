# T-MAX Project Group Skill / T-MAX 项目组技能

## 中文

## 目标

在当前 loop workspace 中持久化 T-MAX 项目背景，并把小能（xiaoneng）业务背景绑定到多个本地代码仓。

## 背景

- 小能背景挂载：`../../.local/t-max/mounts/background/xiaoneng`
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.
- 小能业务背景适用于 `.loop/project.yaml` 中列出的所有仓库。

## 已挂载代码仓

- `KPIUI`: `../../.local/t-max/mounts/repos/KPIUI`
- `max-console-ui`: `../../.local/t-max/mounts/repos/max-console-ui`
- `max-operate-monitor-ui`: `../../.local/t-max/mounts/repos/max-operate-monitor-ui`
- `operateBusiness`: `../../.local/t-max/mounts/repos/operateBusiness`
- `operateSupport`: `../../.local/t-max/mounts/repos/operateSupport`
- `dcm`: `../../.local/t-max/mounts/repos/dcm`
- `scan`: `../../.local/t-max/mounts/repos/scan`

## 规则

1. 小白解析目标仓挂载路径，并在修改任何 T-MAX 目标仓前读取 `workspace/.local/t-max/mounts/background/xiaoneng`；小能只提供业务背景和执行规则，不创建、解析或维护另一套 T-MAX 挂载。
2. 即使这些仓库共享同一份项目背景，也要把它们视为彼此独立的 git worktree。
3. 在 KPIUI、max-console-ui、max-operate-monitor-ui、operateBusiness、operateSupport、dcm、scan 中一致应用小能业务背景指导。
4. 如果挂载缺失或失效，由小白工程运行 `npm run mount:tmax` 刷新挂载，不把挂载生命周期下放给小能。
5. 仓库特定业务修改必须通过 `workspace/.local/t-max/mounts/repos/` 下选中的入口落到目标仓真实 worktree；允许修改目标仓源码，但不得把软链接、`local.paths.yaml` 或其它挂载基础设施当作业务交付内容修改或提交。
6. 修改前检查目标仓库自己的 `git status` 和当前分支；不要假设所有 T-MAX 仓库使用相同默认分支，也不要混入或覆盖已有改动。
7. 已选择 frontend-delivery loop 的任务必须先生成主设计文档和各仓补充分设计文档，通过独立设计评审并获得 `human-design-approval` 后，才允许进入编码；小改快路径不初始化该 loop，也不适用此设计门禁。
8. 业务设计正文和业务代码只能落在当前参与开发的挂载目标仓；工程仓只记录状态、门禁结果、源链接、目标仓和 PR 链接。
9. 在 T-MAX 背景下处理小能相关项目时，默认只做目标仓内的本地修改、校验和状态说明；除非用户明确授权对应动作，否则不要自动暂存、提交或推送目标仓改动。

## 小改快路径

当用户在 T-MAX 挂载仓里点名单个文件、单个字段、单个常量或一个明确删除/替换动作，并且现有实现路径已经明确、改动不会改变接口或数据来源时，按小改快路径执行。读取小能背景只限任务需要的规则，然后读取目标文件和必要直接引用；不要初始化 frontend-delivery loop、设计门禁、页面预检、组件全链路分析或完整页面契约。

首次把字段接入数据字典、让多个请求参数改为同一动态来源或改变接口数据来源时，即使只涉及一个字段，也要路由到小能 `ApiIntegration.dictParam`。只有字典接入已经完成，后续仅删除硬编码、默认值或 fallback 时，才使用小改快路径。

小改快路径只做用户要求的最小改动。验证限于 `rg` 定位与回查、`git diff --check`，以及必要时的目标文件 lint 或语法检查；不要默认构建、完整测试、checkpoint、audit、commit 或 push。

## English

## Purpose

Persist the T-MAX project background in this loop workspace and bind the Xiaoneng business background to multiple local code repositories.

## Background

- Xiaoneng background mount: `../../.local/t-max/mounts/background/xiaoneng`
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.
- The Xiaoneng business background applies to every repository listed in `.loop/project.yaml`.

## Mounted Repositories

- `KPIUI`: `../../.local/t-max/mounts/repos/KPIUI`
- `max-console-ui`: `../../.local/t-max/mounts/repos/max-console-ui`
- `max-operate-monitor-ui`: `../../.local/t-max/mounts/repos/max-operate-monitor-ui`
- `operateBusiness`: `../../.local/t-max/mounts/repos/operateBusiness`
- `operateSupport`: `../../.local/t-max/mounts/repos/operateSupport`
- `dcm`: `../../.local/t-max/mounts/repos/dcm`
- `scan`: `../../.local/t-max/mounts/repos/scan`

## Rules

1. Xiaobai resolves the target repository mount and loads `workspace/.local/t-max/mounts/background/xiaoneng` before modifying any T-MAX target repository. Xiaoneng provides business context and execution rules only; it does not create, resolve, or maintain a second T-MAX mount tree.
2. Treat the repositories as separate git worktrees even though they share the same project background.
3. Apply the Xiaoneng business background consistently across KPIUI, max-console-ui, max-operate-monitor-ui, operateBusiness, operateSupport, dcm, and scan.
4. If a mount is missing or broken, refresh it from the Xiaobai engineering repository with `npm run mount:tmax`; do not delegate mount lifecycle management to Xiaoneng.
5. Apply repository-specific business changes through the selected entry under `workspace/.local/t-max/mounts/repos/` so they land in the target repository's real worktree. Editing target source is allowed, but symlinks, `local.paths.yaml`, and other mount infrastructure must not be changed or committed as business deliverables.
6. Check the target repository's own `git status` and current branch before editing. Do not assume all T-MAX repositories use the same default branch, and do not mix in or overwrite existing changes.
7. A task that has selected the frontend-delivery loop must create the master design document and repository supplements, pass independent design review, and record `human-design-approval` before implementation. The micro patch fast path does not initialize that loop and is exempt from this design gate.
8. Business design bodies and business code belong only in participating mounted target repositories. The engineering repository records only state, gate results, source links, target repositories, and PR links.
9. When working on Xiaoneng-related projects under the T-MAX background, default to local changes, verification, and status reporting inside the target repository. Do not stage, commit, or push target-repository changes unless the user explicitly authorizes the corresponding action.

## Micro Patch Fast Path

When the user names a single file, field, constant, or one explicit deletion/replacement inside a mounted T-MAX repository, and the existing implementation path is already clear without changing an API or data source, use the micro patch fast path. Load only the Xiaoneng background rules needed for the task, then read the target file and necessary direct references; do not initialize the frontend-delivery loop, design gates, page preflight, full component-chain analysis, or a full page contract.

Route first-time data-dictionary integration, shared dynamic request-parameter sourcing, or another API data-source change to Xiaoneng `ApiIntegration.dictParam`, even when only one field is involved. Use the micro patch fast path only for a follow-up that removes a hardcoded value, default, or fallback after the dictionary integration already exists.

The micro patch fast path applies only the smallest requested change. Verification is limited to `rg` lookup/recheck, `git diff --check`, and target-file lint or syntax checks when needed; do not run builds, full tests, checkpoints, audits, commits, or pushes by default.
