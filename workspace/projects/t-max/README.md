# T-MAX Mounted Project Group / T-MAX 挂载项目组

## 中文

这个目录用于持久化 T-MAX 项目组关系：一个共享背景对应多个 T-MAX 本地代码仓。

## 目录结构

- `.loop/project.yaml`：机器可读的标准映射。
- `.loop/local.paths.yaml.example`：每台电脑本机绝对路径的模板。
- `.loop/local.paths.yaml`：本机私有绝对路径，已被 git 忽略。
- `SKILL.md`：项目组级上下文，供 loop 和 agent 运行时读取。
- `workspace/.local/t-max/mounts/background/shared-skills`：生成的 shared-skills 背景仓软链接。
- `workspace/.local/t-max/mounts/repos/*`：生成的 T-MAX 代码仓软链接。

这些软链接不是代码副本。通过挂载路径修改代码，实际修改的是原始本地 git 仓库。

## 每台电脑的配置

每台电脑都可以把 shared-skills 背景和代码仓放在不同位置。

1. 复制 `.loop/local.paths.yaml.example` 为 `.loop/local.paths.yaml`。
2. 编辑 `.loop/local.paths.yaml`，填入这台电脑上的本机绝对路径。
3. 在仓库根目录运行 `npm run mount:tmax`。

不要提交 `.loop/local.paths.yaml`，也不要提交 `workspace/.local/` 下的任何生成物。

## English

This directory persists the T-MAX project-group relationship: one shared background mapped to multiple local T-MAX code repositories.

## Layout

- `.loop/project.yaml`: canonical machine-readable mapping.
- `.loop/local.paths.yaml.example`: template for per-machine absolute paths.
- `.loop/local.paths.yaml`: local-only absolute paths, ignored by git.
- `SKILL.md`: project-group context for loop and agent runs.
- `workspace/.local/t-max/mounts/background/shared-skills`: generated symlink to the shared background repository.
- `workspace/.local/t-max/mounts/repos/*`: generated symlinks to the mounted T-MAX code repositories.

The symlinks are intentionally not code copies. Changes made through a repository mount are changes in the original local git repository.

## Per-Machine Setup

Each computer can keep the shared background and code repositories in different locations.

1. Copy `.loop/local.paths.yaml.example` to `.loop/local.paths.yaml`.
2. Edit `.loop/local.paths.yaml` to match that computer's local absolute paths.
3. Run `npm run mount:tmax` from the repository root.

Do not commit `.loop/local.paths.yaml` or anything generated under `workspace/.local/`.
