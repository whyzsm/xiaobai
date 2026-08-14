# trunkFeeder Project Skill / trunkFeeder 项目技能

## 中文

## 目标

在当前 loop workspace 中持久化 `trunkFeeder` 项目背景，并把它绑定到本地 `trunkFeeder-ui` 业务代码仓。

## 项目背景

- 项目背景名称：`trunkFeeder`。
- 项目背景挂载：`../../.local/trunkFeeder/mounts/background/trunkFeeder`，指向业务仓内的 `skill/` 目录。
- 业务仓库挂载：`../../.local/trunkFeeder/mounts/repos/trunkFeeder-ui`。
- 业务仓库远端：`http://git.ane56-ins.com/T-MAX/trunkFeeder-ui`。
- 本机路径来自 `.loop/local.paths.yaml`，该文件不提交。

## 背景加载规则

1. 修改 `trunkFeeder-ui` 前，先确认挂载存在；缺失时在工程仓根目录运行 `npm run mount:trunkFeeder`。
2. 先读取挂载背景 `workspace/.local/trunkFeeder/mounts/background/trunkFeeder/SKILL.md`，再按其中指引读取 `references/` 和真实源码。
3. 业务代码只能落在 `workspace/.local/trunkFeeder/mounts/repos/trunkFeeder-ui` 对应的本地 git worktree 中。
4. 工程仓只记录项目背景、挂载关系、门禁结果、需求引用和交付说明，不保存业务代码。
5. 修改前检查 `trunkFeeder-ui` 自己的分支和工作区状态，不覆盖已有改动。
6. 不要提交 `.loop/local.paths.yaml`、`workspace/.local/` 软链接或外部仓库内容。
7. 涉及接口数据来源、跨页契约、依赖升级、构建入口、发布配置或破坏性文件操作时，先停在人工确认。
8. 小改快路径只做用户点名的最小改动，验证优先使用 `rg` 回查、`git diff --check` 和目标文件级 lint 或语法检查。
9. `trunkFeeder-ui` 默认已有用户启动的开发服务。Agent 禁止执行 `npm run start`、`yarn start`、`umi dev`、`npm run build`、`yarn build` 等启动或编译命令；只允许修改代码和执行静态检查，页面验证必须使用用户当前已经启动的地址。若确需停止、重启或执行构建，必须先获得用户明确授权。

## English

## Purpose

Persist the `trunkFeeder` project context in this loop workspace and bind it to the local `trunkFeeder-ui` business repository.

## Project Context

- Project context name: `trunkFeeder`.
- Project context mount: `../../.local/trunkFeeder/mounts/background/trunkFeeder`, pointing to the business repository's `skill/` directory.
- Business repository mount: `../../.local/trunkFeeder/mounts/repos/trunkFeeder-ui`.
- Business repository remote: `http://git.ane56-ins.com/T-MAX/trunkFeeder-ui`.
- Local paths are resolved from `.loop/local.paths.yaml`, which is intentionally not committed.

## Context Loading Rules

1. Before changing `trunkFeeder-ui`, confirm the mount exists; refresh it from the engineering repository root with `npm run mount:trunkFeeder` when missing.
2. Load `workspace/.local/trunkFeeder/mounts/background/trunkFeeder/SKILL.md` first, then follow its guidance into `references/` and real source files.
3. Business code belongs only in the local git worktree mounted at `workspace/.local/trunkFeeder/mounts/repos/trunkFeeder-ui`.
4. The engineering repository records only project context, mount mapping, gate results, requirement references, and delivery notes. It must not store business code.
5. Check the `trunkFeeder-ui` branch and working tree before editing, and do not overwrite existing changes.
6. Do not commit `.loop/local.paths.yaml`, `workspace/.local/` symlinks, or external repository contents.
7. Stop for human confirmation before changing API data sources, cross-page contracts, dependencies, build entries, release configuration, or destructive file operations.
8. The micro patch fast path applies only the smallest user-named change, with verification focused on `rg` rechecks, `git diff --check`, and target-file lint or syntax checks.
9. `trunkFeeder-ui` is assumed to have a development service already started by the user. The Agent must not run `npm run start`, `yarn start`, `umi dev`, `npm run build`, or `yarn build`, or equivalent startup/build commands. It may only modify code and run static checks; page verification must use the address currently started by the user. Stopping, restarting, or running a build requires explicit user authorization first.
