# 状态管理 / State Management

## 中文

### 状态分类

小白的状态分层比前端 state 更重要：

- Loop 配置状态：`workspace/loops/*.loop.yaml`。
- Agent 和 harness 状态：`workspace/agents/*.yaml`。
- 项目路由状态：`workspace/projects/<project>/.loop/project.yaml`。
- 本机路径状态：ignored 的 `workspace/workspace.local.yaml` 和 `workspace/projects/*/.loop/local.paths.yaml`。
- Memory 状态：默认 `workspace/memory`，或由本机配置指向 Obsidian vault。
- Control-plane 状态：`WorkspaceControlPlane` 的 `state/workspaces.json`，由 `dataRoot` 控制。
- OpenHands runtime 状态：`deploy/openhands/runtime/` 和容器挂载目录，必须保持分发边界。
- Trellis 状态：`.trellis/tasks/`、`.trellis/workspace/`、`.trellis/spec/`，其中 `.trellis/.developer` 和 `.trellis/.runtime/` 是本机忽略状态。

### Memory 协议

`loop-engineering/docs/obsidian-memory-architecture.md` 定义了 Obsidian memory 层级：

- L0：`runs.jsonl`、`findings.jsonl`、`metrics.jsonl`，机器追加日志。
- L1：`active-context.md`、`inbox.md`、loop state 和 inbox，适合人工维护。
- L2：项目记忆、decisions、cases、patterns。
- L3：跨项目索引。
- L4：`memory-index.json`。
- L5：执行记忆，例如技能说明和已评审模式。

写入 memory 时，优先使用 CLI 命令，不直接手写机器索引。完成有长期价值的工程配置或架构任务后，要写中英双语 summary，运行 `memory:checkpoint`，再运行 `memory:audit-today`。

### 本机状态和 Git

- `workspace/workspace.local.yaml` 只保存本机 memory root 覆盖，不可复制到其他电脑。
- `workspace/.local/` 下的挂载、临时报表和 checkpoint 输入文件不得进入工程提交。
- T-MAX 业务仓状态要在目标仓自己的 Git root 检查，不用小白外层 `git status` 代替。
- `origin` 可有多个 push URL；提交和推送结论必须以实时 remote、branch、SHA 和 ahead/behind 证据为准。

### OpenHands 状态

`deploy/openhands/README.md` 定义了运行边界：小白 `/projects/xiaobai` 可写，小能 `/opt/xiaoneng` 只读，Obsidian `/memory/obsidian` 可写。模型 key、端点、会话密钥和个人 vault 路径只允许来自 ignored `.env` 或接收方环境。

### 常见错误

- 不要把 Obsidian 当成需要插件的数据库。
- 不要手工编辑 JSONL 机器日志。
- 不要把 `.trellis/.runtime/` 当成可提交状态。
- 不要把 OpenHands runtime 的状态目录打进默认分发包。
- 不要在没有审计通过时声称 memory 已持久化。

## English

### State Categories

Xiaobai's state layers matter more than frontend state:

- Loop configuration state: `workspace/loops/*.loop.yaml`.
- Agent and harness state: `workspace/agents/*.yaml`.
- Project routing state: `workspace/projects/<project>/.loop/project.yaml`.
- Machine-local path state: ignored `workspace/workspace.local.yaml` and `workspace/projects/*/.loop/local.paths.yaml`.
- Memory state: default `workspace/memory`, or an Obsidian vault selected through machine-local config.
- Control-plane state: `state/workspaces.json` owned by `WorkspaceControlPlane` under its `dataRoot`.
- OpenHands runtime state: `deploy/openhands/runtime/` and container mount directories, which must preserve distribution boundaries.
- Trellis state: `.trellis/tasks/`, `.trellis/workspace/`, and `.trellis/spec/`; `.trellis/.developer` and `.trellis/.runtime/` are ignored machine-local state.

### Memory Protocol

`loop-engineering/docs/obsidian-memory-architecture.md` defines the Obsidian memory layers:

- L0: `runs.jsonl`, `findings.jsonl`, and `metrics.jsonl`, which are append-only machine logs.
- L1: `active-context.md`, `inbox.md`, loop state, and loop inbox, which are suitable for human maintenance.
- L2: project memory, decisions, cases, and patterns.
- L3: cross-project indexes.
- L4: `memory-index.json`.
- L5: execution memory, such as skill notes and reviewed patterns.

Use CLI commands for memory writes instead of hand-editing machine indexes. After durable engineering configuration or architecture work, write a bilingual summary, run `memory:checkpoint`, and then run `memory:audit-today`.

### Local State And Git

- `workspace/workspace.local.yaml` stores only this machine's memory root override and must not be copied to another computer.
- Mounts, temporary reports, and checkpoint input files under `workspace/.local/` must not enter this repository's commit boundary.
- T-MAX business repository state must be checked inside the target repository's own Git root; the outer Xiaobai `git status` is not enough.
- `origin` may have multiple push URLs. Commit and push claims must be grounded in live remote, branch, SHA, and ahead/behind evidence.

### OpenHands State

`deploy/openhands/README.md` defines the runtime boundary: Xiaobai at `/projects/xiaobai` is writable, Xiaoneng at `/opt/xiaoneng` is read-only, and Obsidian at `/memory/obsidian` is writable. Model keys, endpoints, session secrets, and personal vault paths may come only from ignored `.env` files or recipient environments.

### Common Mistakes

- Do not treat Obsidian as a database that requires plugins.
- Do not hand-edit JSONL machine logs.
- Do not treat `.trellis/.runtime/` as committable state.
- Do not package OpenHands runtime state into the default distribution.
- Do not claim memory persistence unless the audit passed.
