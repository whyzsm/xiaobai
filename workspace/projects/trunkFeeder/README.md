# trunkFeeder Mounted Project / trunkFeeder 挂载项目

## 中文

这个目录用于持久化 `trunkFeeder` 项目背景：背景来自 `trunkFeeder-ui` 仓库中的 `skill/` 文件夹，业务代码来自同一个本地 `trunkFeeder-ui` git 仓库。

## 目录结构

- `.loop/project.yaml`：机器可读的项目映射。
- `.loop/local.paths.yaml.example`：每台电脑本机绝对路径的模板。
- `.loop/local.paths.yaml`：本机私有绝对路径，已被 git 忽略。
- `SKILL.md`：小白项目级上下文，负责说明如何加载挂载背景和业务仓。
- `workspace/.local/trunkFeeder/mounts/background/trunkFeeder`：生成的项目背景软链接，指向 `trunkFeeder-ui/skill`。
- `workspace/.local/trunkFeeder/mounts/repos/trunkFeeder-ui`：生成的业务仓软链接，指向 `trunkFeeder-ui`。

这些软链接不是代码副本。通过挂载路径修改业务代码，实际修改的是原始本地 git 仓库：

```text
/absolute/path/to/trunkFeeder-ui
```

## 每台电脑的配置

1. 复制 `.loop/local.paths.yaml.example` 为 `.loop/local.paths.yaml`。
2. 编辑 `.loop/local.paths.yaml`，把背景路径指向 `trunkFeeder-ui/skill`，把仓库路径指向 `trunkFeeder-ui`。
3. 在工程仓根目录运行 `npm run mount:trunkFeeder`。

不要提交 `.loop/local.paths.yaml`，也不要提交 `workspace/.local/` 下的任何生成物。

## English

This directory persists the `trunkFeeder` project context: the context comes from the `skill/` folder inside the `trunkFeeder-ui` repository, and business code comes from the same local `trunkFeeder-ui` git repository.

## Layout

- `.loop/project.yaml`: canonical machine-readable project mapping.
- `.loop/local.paths.yaml.example`: template for per-machine absolute paths.
- `.loop/local.paths.yaml`: local-only absolute paths, ignored by git.
- `SKILL.md`: Xiaobai project-level context describing how to load the mounted background and business repository.
- `workspace/.local/trunkFeeder/mounts/background/trunkFeeder`: generated project-context symlink pointing to `trunkFeeder-ui/skill`.
- `workspace/.local/trunkFeeder/mounts/repos/trunkFeeder-ui`: generated business-repository symlink pointing to `trunkFeeder-ui`.

The symlinks are intentionally not code copies. Changes made through the mount are changes in the original local git repository:

```text
/absolute/path/to/trunkFeeder-ui
```

## Per-Machine Setup

1. Copy `.loop/local.paths.yaml.example` to `.loop/local.paths.yaml`.
2. Edit `.loop/local.paths.yaml` so the background path points to `trunkFeeder-ui/skill` and the repository path points to `trunkFeeder-ui`.
3. Run `npm run mount:trunkFeeder` from the engineering repository root.

Do not commit `.loop/local.paths.yaml` or anything generated under `workspace/.local/`.
