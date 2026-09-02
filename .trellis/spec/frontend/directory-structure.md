# 目录结构 / Directory Structure

## 中文

### 仓库边界

小白按责任边界组织，而不是按单个 agent runner 组织。`loop-engineering/docs/architecture.md` 明确了两条核心边界：

- `loop-engineering/` 是引擎层，放 runtime、schema、CLI、模板和测试。
- `workspace/` 是运行空间，放 loop 配置、项目知识、agent、connector、memory、budget、报告和本机挂载模板。

### 目录职责

- `loop-engineering/cli/`：命令入口。`loop.ts` 负责 `validate`、`dry-run`、`simulate` 和 `memory` 分派；`memory.ts` 负责 memory 子命令。
- `loop-engineering/packages/`：按能力拆分 runtime 包，例如 `loop-runtime`、`project-registry`、`memory-protocol`、`memory-indexer`、`control-plane`。
- `loop-engineering/schemas/`：YAML/JSON 配置的 JSON Schema。修改 loop、agent、connector、budget、harness 结构时，要同步考虑这里。
- `loop-engineering/tests/`：Node test runner 测试。`runtime.test.ts` 覆盖 loop routing、workflow gate 和 orchestrator 输出；`memory-cli.test.ts` 覆盖 Obsidian memory 生命周期。
- `workspace/loops/`：loop YAML。`frontend-delivery.loop.yaml` 是面向业务前端交付的流程；`morning-triage.loop.yaml` 是默认 triage 流程。
- `workspace/agents/`：agent 与 harness YAML。`xiaobai.orchestrator.agent.yaml` 是小白编排入口。
- `workspace/projects/`：项目级知识、项目路由和本机路径模板。T-MAX 的真源是 `workspace/projects/t-max/.loop/project.yaml`。
- `workspace/connectors/`：外部系统 connector 配置，凭据只能通过环境变量读取。
- `workspace/memory/`：默认 memory root；真实跨终端 memory 可由 ignored 的 `workspace/workspace.local.yaml` 指向 Obsidian vault。
- `deploy/openhands/`：OpenHands 分发与运行适配层，只做适配，不复制或替代 `loop-engineering/` 的编排实现。
- `data/` 和 `docs/plans/`：历史案例、索引和计划材料；不要把它们当成 runtime 真源。

### 本机状态

以下状态必须保持 ignored，不进入工程提交边界：

- `workspace/.local/`
- `workspace/workspace.local.yaml`
- `workspace/projects/*/.loop/local.paths.yaml`
- `deploy/openhands/.env`
- `dist/`
- `.trellis/.developer`
- `.trellis/.runtime/`

T-MAX 业务代码和小能背景通过 `workspace/.local/t-max/mounts/` 访问。业务源码改动属于目标仓自己的 Git worktree，不属于小白工程仓。

### 常见错误

- 不要把 T-MAX 业务仓源码复制进小白仓库。
- 不要在 `deploy/openhands/` 里重新实现 loop 编排。
- 不要把本机绝对路径、模型 key、OpenHands 会话密钥或个人 Vault 路径写进 tracked 文件。
- 不要在只需要项目路由元数据时运行要求完整 T-MAX 业务仓挂载的本机挂载流程。

## English

### Repository Boundary

Xiaobai is organized around responsibility boundaries, not around one agent runner. `loop-engineering/docs/architecture.md` defines the two core boundaries:

- `loop-engineering/` is the engine layer for runtimes, schemas, CLI, templates, and tests.
- `workspace/` is the operating space for loop specs, project knowledge, agents, connectors, memory, budgets, reports, and local mount templates.

### Directory Responsibilities

- `loop-engineering/cli/`: command entrypoints. `loop.ts` dispatches `validate`, `dry-run`, `simulate`, and `memory`; `memory.ts` owns memory subcommands.
- `loop-engineering/packages/`: capability-oriented runtime packages, such as `loop-runtime`, `project-registry`, `memory-protocol`, `memory-indexer`, and `control-plane`.
- `loop-engineering/schemas/`: JSON Schema for YAML/JSON configuration. When loop, agent, connector, budget, or harness structures change, consider these schemas too.
- `loop-engineering/tests/`: Node test runner tests. `runtime.test.ts` covers loop routing, workflow gates, and orchestrator output; `memory-cli.test.ts` covers the Obsidian memory lifecycle.
- `workspace/loops/`: loop YAML files. `frontend-delivery.loop.yaml` drives business frontend delivery; `morning-triage.loop.yaml` is the default triage loop.
- `workspace/agents/`: agent and harness YAML files. `xiaobai.orchestrator.agent.yaml` is the Xiaobai orchestration entrypoint.
- `workspace/projects/`: project-level knowledge, project routing, and local path templates. For T-MAX, the source of truth is `workspace/projects/t-max/.loop/project.yaml`.
- `workspace/connectors/`: external-system connector configuration. Credentials must be read only from environment variables.
- `workspace/memory/`: default memory root. Real cross-terminal memory can be redirected to an Obsidian vault through the ignored `workspace/workspace.local.yaml`.
- `deploy/openhands/`: OpenHands distribution and runtime adapter. It adapts; it must not copy or replace orchestration from `loop-engineering/`.
- `data/` and `docs/plans/`: historical cases, indexes, and planning material. Do not treat them as runtime source of truth.

### Local State

The following state must remain ignored and outside this repository's commit boundary:

- `workspace/.local/`
- `workspace/workspace.local.yaml`
- `workspace/projects/*/.loop/local.paths.yaml`
- `deploy/openhands/.env`
- `dist/`
- `.trellis/.developer`
- `.trellis/.runtime/`

T-MAX business code and the Xiaoneng background are accessed through `workspace/.local/t-max/mounts/`. Business source changes belong to the target repository's own Git worktree, not to the Xiaobai engineering repository.

### Common Mistakes

- Do not copy T-MAX business source into the Xiaobai repository.
- Do not reimplement loop orchestration inside `deploy/openhands/`.
- Do not write machine-specific absolute paths, model keys, OpenHands session secrets, or personal Vault paths into tracked files.
- Do not run the local mount flow that requires a complete T-MAX business-repository mount when only project routing metadata is needed.
