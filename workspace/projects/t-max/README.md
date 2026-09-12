# T-MAX Mounted Project Group / T-MAX 挂载项目组

## 中文

这个目录持久化 T-MAX 项目组基础设施。Batch E 之后：所有 T-MAX 仓库都在各自的独立 Project 中运行（executor=xigua），本组不再声明背景，也不登记任何仓库；它保留共享的挂载脚本、frontend-delivery loop 技能与默认项目引用。

## 目录结构

- `.loop/project.yaml`：机器可读的标准映射（无 background、无 repositories）。
- `.loop/local.paths.yaml.example`：每台电脑本机绝对路径的模板。
- `.loop/local.paths.yaml`：本机私有绝对路径，已被 git 忽略。
- `SKILL.md`：项目组级上下文，供 loop 和 agent 运行时读取。
- `scripts/mount-local.mjs`：维护整个挂载根，包括各独立子项目的仓库与 xigua 背景。
- `workspace/.local/t-max/mounts/background/xigua`：共享 xigua 真源软链接（由独立项目声明）。
- `workspace/.local/t-max/mounts/repos/*`：各独立项目声明的 T-MAX 代码仓软链接。

这些软链接不是代码副本。通过挂载路径修改代码，实际修改的是原始本地 git 仓库。

## 每台电脑的配置

1. 复制 `.loop/local.paths.yaml.example` 为 `.loop/local.paths.yaml`。
2. 为用到的每个独立项目复制 `workspace/projects/<repoId>/.loop/local.paths.yaml.example` 并填入本机绝对路径。
3. 在仓库根目录运行 `npm run mount:tmax`。

不要提交任何 `local.paths.yaml`，也不要提交 `workspace/.local/` 下的任何生成物。

## English

This directory persists T-MAX group infrastructure. After Batch E: every T-MAX repository runs in its own standalone Project (executor=xigua); this group declares no background and registers no repositories. It keeps the shared mount script, the frontend-delivery loop skills, and the loop's default project reference.

## Layout

- `.loop/project.yaml`: canonical machine-readable mapping (no background, no repositories).
- `.loop/local.paths.yaml.example`: template for per-machine absolute paths.
- `.loop/local.paths.yaml`: local-only absolute paths, ignored by git.
- `SKILL.md`: project-group context for loop and agent runs.
- `scripts/mount-local.mjs`: maintains the whole mounts root, including each standalone child project's repository and the xigua background.
- `workspace/.local/t-max/mounts/background/xigua`: shared symlink to the xigua canonical source (declared by the standalone projects).
- `workspace/.local/t-max/mounts/repos/*`: symlinks to T-MAX repositories declared by the standalone projects.

The symlinks are intentionally not code copies. Changes made through a repository mount are changes in the original local git repository.

## Per-Machine Setup

1. Copy `.loop/local.paths.yaml.example` to `.loop/local.paths.yaml`.
2. For each standalone project in use, copy `workspace/projects/<repoId>/.loop/local.paths.yaml.example` and fill in that machine's absolute paths.
3. Run `npm run mount:tmax` from the repository root.

Do not commit any `local.paths.yaml` or anything generated under `workspace/.local/`.
