# T-MAX Project Group Skill / T-MAX 项目组技能

## 中文

## 目标

在当前 loop workspace 中持久化 T-MAX 项目组基础设施。Batch E 之后，本组不声明任何背景、不登记任何仓库；所有 T-MAX 仓库在各自的独立 Project 中运行（executor=xigua），路由、范围与执行规范以 `workspace/projects/<repoId>/SKILL.md` 为准。

## 背景与迁移状态

- 所有原 t-max 仓库已迁移为独立 Project（kind: Project，executor=xigua）：`KPIUI`、`max-console-ui`、`max-operate-monitor-ui`、`operateBusiness`、`operateSupport`、`dcm`、`scan`。
- 旧 xiaoneng（manifest-source）路由已随 Batch E 下线：背景声明与入口规则已移除；本机遗留挂载软链接在明确执行 Batch E 前保留；xiaoneng 源码仓本身未删除。
- 本组保留共享基础设施：`scripts/mount-local.mjs`（维护整个挂载根，含独立子项目）、frontend-delivery loop 技能与 loop 默认项目引用。普通挂载刷新不会删除未声明的旧背景；Batch E 删除必须显式开启删除开关并单独确认。
- Local paths are resolved from each project's `.loop/local.paths.yaml`, which is intentionally not committed.

## 规则（T-MAX 仓操作约定，随各独立项目继续生效）

1. 仓库前缀标记路由、执行链与停止条件以各独立项目的 `SKILL.md` 与 xigua `AGENT.md` 为准。
2. 即使这些仓库共享同一挂载根，也要把它们视为彼此独立的 git worktree。
3. 如果挂载缺失或失效，由小白工程运行 `npm run mount:tmax` 刷新挂载，不把挂载生命周期下放给任何业务执行者。
4. 仓库特定业务修改必须通过 `workspace/.local/t-max/mounts/repos/` 下选中的入口落到目标仓真实 worktree；允许修改目标仓源码，但不得把软链接、`local.paths.yaml` 或其它挂载基础设施当作业务交付内容修改或提交。
5. 修改前检查目标仓库自己的 `git status` 和当前分支；不要假设所有 T-MAX 仓库使用相同默认分支，也不要混入或覆盖已有改动。
6. 已选择 frontend-delivery loop 的任务必须先生成主设计文档和各仓补充分设计文档，通过独立设计评审并获得 `human-design-approval` 后，才允许进入编码；小改快路径不初始化该 loop，也不适用此设计门禁。
7. 业务设计正文和业务代码只能落在当前参与开发的挂载目标仓；工程仓只记录状态、门禁结果、源链接、目标仓和 PR 链接。
8. 默认只做目标仓内的本地修改、校验和状态说明；除非用户明确授权对应动作，否则不要自动暂存、提交或推送目标仓改动。
9. T-MAX 各业务仓默认已有用户启动的开发服务。Agent 禁止执行 `npm run start`、`yarn start`、`umi dev`、`npm run build`、`yarn build` 等启动或编译命令；只允许修改代码和执行静态检查，页面验证必须使用用户当前已经启动的地址。若确需停止、重启或执行构建，必须先获得用户明确授权。

## 小改快路径

当用户在 T-MAX 挂载仓里点名单个文件、单个字段、单个常量或一个明确删除/替换动作，并且现有实现路径已经明确、改动不会改变接口或数据来源时，按小改快路径执行。读取规范只限任务需要的部分，然后读取目标文件和必要直接引用；不要初始化 frontend-delivery loop、设计门禁、页面预检、组件全链路分析或完整页面契约。

首次把字段接入数据字典、让多个请求参数改为同一动态来源或改变接口数据来源时，即使只涉及一个字段，也要先确认对应执行链的规则；只有相关接入已经完成，后续仅删除硬编码、默认值或 fallback 时，才使用小改快路径。

小改快路径只做用户要求的最小改动。验证限于 `rg` 定位与回查、`git diff --check`，以及必要时的目标文件 lint 或语法检查；不要默认构建、完整测试、checkpoint、audit、commit 或 push。

## English

## Purpose

Persist the T-MAX group infrastructure in this loop workspace. After Batch E, this group declares no background and registers no repository; every T-MAX repository runs in its own standalone Project (executor=xigua), and routing, scope, and execution rules follow `workspace/projects/<repoId>/SKILL.md`.

## Background And Migration Status

- All former t-max repositories migrated to standalone Projects (kind: Project, executor=xigua): `KPIUI`, `max-console-ui`, `max-operate-monitor-ui`, `operateBusiness`, `operateSupport`, `dcm`, `scan`.
- The legacy Xiaoneng (manifest-source) route was retired with Batch E: its background declaration and entry rules were removed; any legacy local mount symlink is preserved until Batch E is explicitly executed; the Xiaoneng source repository itself was not deleted.
- The group keeps shared infrastructure: `scripts/mount-local.mjs` (maintains the whole mounts root including standalone child projects), the frontend-delivery loop skills, and the loop's default project reference. A normal mount refresh does not delete undeclared legacy backgrounds; Batch E deletion requires the explicit removal switch and separate confirmation.
- Local paths are resolved from each project's `.loop/local.paths.yaml`, which is intentionally not committed.

## Rules (operating conventions for T-MAX repositories, effective through each standalone project)

1. Repository-marker routing, execution chains, and stop conditions follow each standalone project's `SKILL.md` and the xigua `AGENT.md`.
2. Treat the repositories as separate git worktrees even though they share the same mounts root.
3. If a mount is missing or broken, refresh it from the Xiaobai engineering repository with `npm run mount:tmax`; do not delegate mount lifecycle management to any business executor.
4. Apply repository-specific business changes through the selected entry under `workspace/.local/t-max/mounts/repos/` so they land in the target repository's real worktree. Editing target source is allowed, but symlinks, `local.paths.yaml`, and other mount infrastructure must not be changed or committed as business deliverables.
5. Check the target repository's own `git status` and current branch before editing. Do not assume all T-MAX repositories use the same default branch, and do not mix in or overwrite existing changes.
6. A task that has selected the frontend-delivery loop must create the master design document and repository supplements, pass independent design review, and record `human-design-approval` before implementation. The micro patch fast path does not initialize that loop and is exempt from this design gate.
7. Business design bodies and business code belong only in participating mounted target repositories. The engineering repository records only state, gate results, source links, target repositories, and PR links.
8. Default to local changes, verification, and status reporting inside the target repository. Do not stage, commit, or push target-repository changes unless the user explicitly authorizes the corresponding action.
9. Each T-MAX business repository is assumed to have a development service already started by the user. The Agent must not run `npm run start`, `yarn start`, `umi dev`, `npm run build`, or `yarn build`, or equivalent startup/build commands. It may only modify code and run static checks; page verification must use the address currently started by the user. Stopping, restarting, or running a build requires explicit user authorization first.

## Micro Patch Fast Path

When the user names a single file, field, constant, or one explicit deletion/replacement inside a mounted T-MAX repository, and the existing implementation path is already clear without changing an API or data source, use the micro patch fast path. Load only the rules the task needs, then read the target file and necessary direct references; do not initialize the frontend-delivery loop, design gates, page preflight, full component-chain analysis, or a full page contract.

Route first-time data-dictionary integration, shared dynamic request-parameter sourcing, or another API data-source change through the corresponding execution chain's rules even when only one field is involved. Use the micro patch fast path only for a follow-up that removes a hardcoded value, default, or fallback after the integration already exists.

The micro patch fast path applies only the smallest requested change. Verification is limited to `rg` lookup/recheck, `git diff --check`, and target-file lint or syntax checks when needed; do not run builds, full tests, checkpoints, audits, commits, or pushes by default.
