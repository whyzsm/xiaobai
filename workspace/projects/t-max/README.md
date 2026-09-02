# T-MAX Mounted Project Group / T-MAX 挂载项目组

## 中文

这个目录用于持久化 T-MAX 项目组关系：项目工程规则绑定多个 T-MAX 本地代码仓，dcm 的业务知识通过只读 IMA scope 检索。

This directory persists the T-MAX project-group relationship: project-owned engineering rules bind multiple local T-MAX repositories, while dcm business knowledge is retrieved from the read-only IMA scope.

## 目录结构

- `.loop/project.yaml`：机器可读的标准映射。
- `.loop/local.paths.yaml.example`：每台电脑本机绝对路径的模板。
- `.loop/local.paths.yaml`：本机私有绝对路径，已被 git 忽略。
- `SKILL.md`：项目组级上下文，供 loop 和 agent 运行时读取。
- `.loop/shared/tmax-engineering.context.yaml`：版本化、只读的项目工程规则。
- `.loop/project.yaml` 与 `projects/dcm/.loop/project.yaml`：分别声明工程规则和 dcm IMA binding；不保存 IMA 凭据或个人知识库路径。
- `workspace/.local/t-max/mounts/repos/*`：生成的 T-MAX 代码仓软链接。

这些软链接不是代码副本。通过挂载路径修改代码，实际修改的是原始本地 git 仓库。

## 每台电脑的配置

每台电脑都可以把代码仓放在不同位置；项目工程规则随仓库版本化，IMA 只在运行时提供只读业务知识。

Each computer may keep the code repositories in different locations; project engineering rules are versioned here, while IMA supplies read-only business knowledge at runtime.

1. 复制 `.loop/local.paths.yaml.example` 为 `.loop/local.paths.yaml`。
2. 编辑 `.loop/local.paths.yaml`，填入这台电脑上的本机绝对路径。
3. 在仓库根目录运行 `npm run mount:tmax`。

不要提交 `.loop/local.paths.yaml`，也不要提交 `workspace/.local/` 下的任何生成物。

## English

This directory persists the T-MAX project-group relationship: project-owned engineering rules map to multiple local T-MAX code repositories, while dcm business knowledge is retrieved from the read-only IMA scope.

## Layout

- `.loop/project.yaml`: canonical machine-readable mapping.
- `.loop/local.paths.yaml.example`: template for per-machine absolute paths.
- `.loop/local.paths.yaml`: local-only absolute paths, ignored by git.
- `SKILL.md`: project-group context for loop and agent runs.
- `.loop/shared/tmax-engineering.context.yaml`: versioned, read-only project engineering rules.
- `.loop/project.yaml` and `projects/dcm/.loop/project.yaml`: engineering and dcm IMA bindings; no IMA credentials or personal knowledge-base paths are stored.
- `workspace/.local/t-max/mounts/repos/*`: generated symlinks to the mounted T-MAX code repositories.

The symlinks are intentionally not code copies. Changes made through a repository mount are changes in the original local git repository.

## Per-Machine Setup

Each computer can keep the code repositories in different locations; project engineering rules are versioned here, while IMA supplies read-only business knowledge at runtime.

1. Copy `.loop/local.paths.yaml.example` to `.loop/local.paths.yaml`.
2. Edit `.loop/local.paths.yaml` to match that computer's local absolute paths.
3. Run `npm run mount:tmax` from the repository root.

Do not commit `.loop/local.paths.yaml` or anything generated under `workspace/.local/`.
