# T-MAX Shared Background Skill / T-MAX 公共背景技能

## 中文

当前 T-MAX 业务已按仓库拆成独立项目。`workspace/projects/t-max` 只保留公共背景兼容入口；实际业务项目位于同级目录，每个项目只允许一个业务仓，并统一使用 `xiaoneng` 背景。

每个独立项目都必须：

1. 在自己的 `.loop/project.yaml` 中声明唯一业务仓和 `xiaoneng` 背景。
2. 使用自己的挂载根目录 `../../.local/t-max/<project>/mounts`，避免不同项目共享可写业务仓入口。
3. 修改业务仓前读取该项目的 `mounts/background/xiaoneng`，并检查业务仓自己的分支、工作区和已有改动。
4. 将业务代码写入该项目唯一的 `mounts/repos/<repository>`，不把业务源码写入工程仓。
5. 默认只做目标仓内的本地修改、静态检查和状态说明，不自动暂存、提交或推送。

公共背景源仍由 `.loop/local.paths.yaml` 中的 `background.xiaoneng` 指定。挂载命令统一复用 `scripts/mount-project.mjs`，通过 `npm run mount:<project>` 执行。

## English

T-MAX business repositories are now split into standalone projects. `workspace/projects/t-max` keeps only a compatibility entry for the shared background; actual business projects live beside it, each with exactly one business repository and the shared `xiaoneng` background.

Every standalone project must:

1. Declare exactly one business repository and the `xiaoneng` background in its own `.loop/project.yaml`.
2. Use its own mount root at `../../.local/t-max/<project>/mounts` so projects do not share writable business-repository entries.
3. Read the project's `mounts/background/xiaoneng` and inspect the repository's own branch, worktree, and existing changes before editing.
4. Write business code only through that project's single `mounts/repos/<repository>` entry; never write business source into the engineering repository.
5. Default to local edits, static checks, and status reporting in the target repository without automatic staging, commit, or push.

The shared background source remains configured as `background.xiaoneng` in each `.loop/local.paths.yaml`. Mounting reuses `scripts/mount-project.mjs` through `npm run mount:<project>`.
