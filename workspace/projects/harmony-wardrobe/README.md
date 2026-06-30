# Harmony Wardrobe Mounted Project / 鸿蒙衣橱柜挂载项目

## 中文

这个目录用于持久化 `harmonyWardrobe` 的独立单项目背景：一个鸿蒙原生开发个人衣橱柜管理 app，对应一个本地代码仓。

## 目录结构

- `.loop/project.yaml`：机器可读的项目映射。
- `.loop/local.paths.yaml.example`：每台电脑本机绝对路径的模板。
- `.loop/local.paths.yaml`：本机私有绝对路径，已被 git 忽略。
- `SKILL.md`：项目级上下文，供 loop 和 agent 运行时读取。
- `workspace/.local/harmony-wardrobe/mounts/background/harmonyWardrobe`：生成的项目背景软链接。
- `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`：生成的代码仓软链接。

这些软链接不是代码副本。通过挂载路径修改代码，实际修改的是原始本地 git 仓库：

```text
/absolute/path/to/harmonyWardrobe
```

## 每台电脑的配置

1. 复制 `.loop/local.paths.yaml.example` 为 `.loop/local.paths.yaml`。
2. 编辑 `.loop/local.paths.yaml`，填入这台电脑上的本机绝对路径。
3. 在工程仓根目录运行 `npm run mount:harmony-wardrobe`。

不要提交 `.loop/local.paths.yaml`，也不要提交 `workspace/.local/` 下的任何生成物。

## English

This directory persists the standalone `harmonyWardrobe` project context: a native HarmonyOS personal wardrobe management app mapped to one local code repository.

## Layout

- `.loop/project.yaml`: canonical machine-readable project mapping.
- `.loop/local.paths.yaml.example`: template for per-machine absolute paths.
- `.loop/local.paths.yaml`: local-only absolute paths, ignored by git.
- `SKILL.md`: project-level context for loop and agent runs.
- `workspace/.local/harmony-wardrobe/mounts/background/harmonyWardrobe`: generated symlink to the project context.
- `workspace/.local/harmony-wardrobe/mounts/repos/harmonyWardrobe`: generated symlink to the code repository.

The symlinks are intentionally not code copies. Changes made through the mount are changes in the original local git repository:

```text
/absolute/path/to/harmonyWardrobe
```

## Per-Machine Setup

1. Copy `.loop/local.paths.yaml.example` to `.loop/local.paths.yaml`.
2. Edit `.loop/local.paths.yaml` to match that computer's local absolute path.
3. Run `npm run mount:harmony-wardrobe` from the engineering repository root.

Do not commit `.loop/local.paths.yaml` or anything generated under `workspace/.local/`.
