# dcm Project Skill / dcm 项目技能

## 中文

`dcm` 是独立 T-MAX 业务项目，只挂载 `dcm` 业务仓，并使用 `xiaoneng` 作为公共背景。

- 项目挂载根目录：`../../.local/t-max/dcm/mounts`
- 公共背景：`../../.local/t-max/dcm/mounts/background/xiaoneng`
- 业务仓：`../../.local/t-max/dcm/mounts/repos/dcm`
- 本机路径配置：`.loop/local.paths.yaml`，不提交

修改前先读取公共背景并检查业务仓自己的分支、工作区和已有改动。业务代码只能落在 `dcm` 业务仓。默认只做本地修改、静态检查和状态说明，不自动提交或推送。

## English

`dcm` is a standalone T-MAX business project. It mounts only the `dcm` business repository and uses `xiaoneng` as its shared background.

- Project mount root: `../../.local/t-max/dcm/mounts`
- Shared background: `../../.local/t-max/dcm/mounts/background/xiaoneng`
- Business repository: `../../.local/t-max/dcm/mounts/repos/dcm`
- Machine-local paths: `.loop/local.paths.yaml`, never committed

Before changing `dcm`, read the shared background and inspect the repository's branch, worktree, and existing changes. Business code belongs only in `dcm`. Default to local edits, static checks, and status reporting without automatic commit or push.
