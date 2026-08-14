# Loop Engineering 架构 / Loop Engineering Architecture

## 中文

### 责任边界

系统按责任边界组织，而不是围绕单个 agent runner 组织。`loop-engineering/` 是可复用引擎，负责 runtime、schema、CLI、模板和测试；`workspace/` 是运行空间，负责项目 loop、项目 Skill、connector 配置、持久 memory、worktree、报告、agent 和 budget。

### 核心契约

Loop spec 必须显式表达以下步骤：

```text
discovery -> handoff -> verification -> persistence -> schedule
```

每个步骤由独立 runtime package 负责，防止系统退化为一个大型 prompt 或大型 orchestrator。能力扩展优先使用小型 provider 合同，例如 executor、context、evidence 和 telemetry provider；只有在存在多个真实实现时才增加通用插件层。

### 三个事件平面

- 工作流控制平面使用 `StageEvent`，记录节点进入、首次动作、真实等待区间、终态和证据。
- 执行事实平面使用 `ExecutionEvent`，记录上下文解析、prompt digest、模型请求、工具调用、Harness verdict 和 evaluator verdict。模型请求必须关联先前记录的 prompt 组装事实，工具结果必须关联工具调用。
- 授权平面使用 `GatePass`，记录受保护动作、subject/policy digest、签发者、证据、过期和撤销。

三个平面不得互相替代：配置中的计划不是执行事实，执行成功不是人工授权，generator 自评也不是 evaluator verdict。

### 能力目录

`loop catalog` 从 workspace 的 loop、agent 和 harness 真源生成只读目录，列出节点 owner、executor 类型、工具策略、上下文加载器、输出和门禁。目录必须明确区分“executor 上报后由引擎校验”与“运行时直接拦截”，不得把上报式检查描述为不可绕过的工具权限边界。

### 安全默认值

- Generator 与 evaluator 使用不同 agent spec；evaluator verdict 只有在身份独立且 Harness 通过时才能批准。
- Dry run 不修改 workspace。
- Memory 持久化在磁盘上，不等同于 prompt context。
- Connector 默认拒绝 merge 和 repository settings 修改。
- Human gate 保护 merge、鉴权、付款、破坏性文件操作和主要依赖升级。
- Budget 在规划运行之前校验。
- 过大的执行事件 payload 写入权限受控的 spill 文件，日志只保留 digest、字节数和定位信息。

## English

### Responsibility Boundaries

The system is organized around responsibility boundaries instead of a single agent runner. `loop-engineering/` is the reusable engine and owns runtimes, schemas, the CLI, templates, and tests. `workspace/` is the operating space and owns project loops, project skills, connector configuration, persistent memory, worktrees, reports, agents, and budgets.

### Core Contract

A loop spec must make these steps explicit:

```text
discovery -> handoff -> verification -> persistence -> schedule
```

Each step is handled by a separate runtime package so the system does not collapse into one large prompt or orchestrator. Capability extensions should start with small provider contracts, such as executor, context, evidence, and telemetry providers. Add a general plugin layer only after multiple real implementations exist.

### Three Event Planes

- The workflow control plane uses `StageEvent` to record stage entry, first action, real waiting intervals, terminal state, and evidence.
- The execution facts plane uses `ExecutionEvent` to record context resolution, prompt digests, model requests, tool calls, Harness verdicts, and evaluator verdicts. Every model request must reference a previously recorded prompt assembly fact, and every tool result must reference a tool call.
- The authorization plane uses `GatePass` to record protected actions, subject and policy digests, issuers, evidence, expiry, and revocation.

The three planes must not replace each other: planned configuration is not an execution fact, successful execution is not human authorization, and generator self-review is not an evaluator verdict.

### Capability Catalog

`loop catalog` generates a read-only catalog from the workspace loop, agent, and harness sources of truth. It lists stage owners, executor kinds, tool policies, context loaders, outputs, and gates. The catalog must distinguish "executor-reported and engine-validated" checks from direct runtime interception and must not describe reported checks as an unbypassable tool permission boundary.

### Safety Defaults

- Generator and evaluator use separate agent specs. An evaluator verdict can approve only when the identity is independent and the Harness passes.
- Dry runs do not mutate the workspace.
- Memory is disk-backed and is not automatically prompt context.
- Connector write permissions deny merge and repository settings changes by default.
- Human gates protect merge, authentication, payment, destructive file changes, and major dependency upgrades.
- Budget limits are validated before planning a run.
- Oversized execution-event payloads are written to permission-controlled spill files; the event log retains only the digest, byte count, and locator.
