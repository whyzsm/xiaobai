# 小白评价工程体系 / Xiaobai Evaluation Engineering System

## 中文

### 目标

本标准定义“小白”自身能力的评价口径。小白不是单个 prompt、单个 agent 或一次答复，而是由引擎、workspace、loop、agent、harness、evaluator、human gate、memory、报告和 Git 交付闭环组成的工程系统。

评价目标不是判断“回答看起来好不好”，而是判断系统是否能稳定地把任务路由到真源、拆成可执行节点、保留证据、通过门禁、完成交付，并在失败时定位到具体节点和原因。

### 评价对象

评价报告必须覆盖以下对象：

- `loop-engineering/` 引擎层：runtime、schema、CLI、模板和测试。
- `workspace/` 运行空间：loop spec、project knowledge、agent、connector、memory、budget、报告和本机挂载模板。
- Orchestrator：是否能解析用户目标、项目、仓库、背景、loop 和执行边界。
- Generator 与 harness：是否有明确输入、输出、工具边界和完成条件。
- Evaluator 与 human gate：是否独立于 generator，并能真实阻断或标记不合格结果。
- Memory 与 reports：是否能还原任务上下文、决策、验证、结果和复用结论。
- Git 与远端闭环：是否能证明分支、提交、远端 SHA、工作区状态和未提交风险。

### 评价维度

建议使用以下维度打分或分级：

| 维度 | 必看证据 | 不合格信号 |
| --- | --- | --- |
| 目标解析 | 用户请求、目标项目、目标仓库、目标分支、loop 选择 | 目标含糊时直接实现 |
| 路由真源 | `project.yaml`、项目 `SKILL.md`、目标仓 `git status`、远端 URL | 依靠记忆或猜测决定仓库 |
| 节点契约 | workflow stage、输入、输出、owner、required checks | 节点只有名称，没有可验收输出 |
| 门禁有效性 | evaluator 结论、human gate、验证命令、阻断记录 | generator 自评被当作完成 |
| 节点停留时间 | stage timing、等待原因、主动耗时、阻塞节点 | 没有时间采集却声称效率高 |
| 交付闭环 | commit、push、remote SHA、status、测试结果 | 只说“已完成”，没有执行证据 |
| 失败恢复 | failure reason、next action、责任方、可重试步骤 | 失败只给泛泛解释 |
| 知识沉淀 | checkpoint、audit、case、index、可复用规则 | 有长期价值但没有沉淀 |

### 节点停留时间模型

每个 workflow 节点必须能记录或显式标记以下字段：

| 字段 | 含义 |
| --- | --- |
| `stageId` | 节点 ID，对应 loop spec 中的 workflow stage |
| `stageKind` | 节点类型，例如 intake、design、review、coding、human-gate、pr-readiness |
| `owner` | 当前责任方，例如 orchestrator、generator、evaluator、human、tool、external-system |
| `status` | `planned`、`running`、`waiting`、`passed`、`failed`、`skipped`、`blocked`、`unmeasured` |
| `enteredAt` | 进入节点的时间 |
| `firstActionAt` | 节点内首次有效动作的时间 |
| `exitedAt` | 离开节点的时间 |
| `durationMs` | 节点总停留时间 |
| `activeMs` | 主动执行耗时 |
| `waitingMs` | 等待耗时 |
| `waitingReason` | 等待原因，例如 `human_input`、`tool_running`、`external_api`、`missing_context`、`approval_required`、`error_blocker` |
| `evidence` | 支撑节点状态的命令、文件、报告、截图、远端 SHA 或日志 |

如果没有真实采集数据，评价报告必须写 `unmeasured`，不能用估算值填充。未采集节点停留时间本身就是可观测性缺口，应进入评价发现。

### 运行时事件与 xigua 可观测性

运行时应把 `StageExecutionEvent` 逐行追加到 loop memory 下的 `stage-events.jsonl`，不得覆盖或重排已有事件。事件生命周期只能使用 `entered`、`first_action`、`waiting`、`completed`、`failed`、`skipped`、`blocked`；每条记录必须包含 `loopId`、`runId`、`taskId`、`stageId`、`stageKind`、`owner`、`event`、`status`、`timestamp`，并按需包含 `waitingReason` 与 `evidence`。

`WorkflowExecutor` 只负责任务依赖、并发上限和事件证据的调度。它执行宿主提供的 `run()`，不自行创建 Agent、调用模型或写入业务仓库；真实 Agent 调用、权限和业务写入继续由宿主负责。因而阶段计划不能被描述为已经启用的多 Agent 并行执行，除非宿主提供了真实的调用适配器和对应事件证据。

计时只从真实事件推导：`durationMs=exitedAt-enteredAt`，等待区间从最后一个 `waiting` 到退出或当前观测时间，`activeMs=durationMs-waitingMs`。`human_input`、`tool_running`、`external_api`、`missing_context`、`approval_required`、`error_blocker` 和 `dependency_waiting` 必须分别归因；缺少进入或退出事件时不得补估。

监控可以从最新 run 的事件元数据展示未在 YAML loop spec 声明的运行时 xigua 阶段，并将来源标记为 `stage-events.jsonl`。没有真实事件时不得预填 xigua 阶段或时长，仍应报告 `unmeasured`。

xigua 源消费证据中的 `sourceFingerprint` 是 `sourceCommit`、`AGENT.md` 内容哈希和完整源工作树状态的稳定哈希；`sourceDirty` 与 `sourceWorktreeStatus` 用于说明读取的是哪一个源状态，而不是业务仓写入证明。

当 `Scaffold` 的 `apiStatus=api_contract_missing` 时，`continuation.deliveryStatus=scaffold_delivered` 表示页面目录、路由和静态交付已经完成；`nextMode=ApiWiring` 仅携带待确认 API 合同输入。它不等价于自动恢复、自动联调或自动派发，后续执行必须由用户或宿主显式发起。

### 报告格式

评价报告至少包含以下表格：

| 节点 | 类型 | 责任方 | 状态 | 停留时间 | 主动耗时 | 等待耗时 | 等待原因 | 证据 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| requirement-intake | intake | generator | passed | 120000 | 90000 | 30000 | tool_running | report path | - |

没有真实时间时必须这样写：

| 节点 | 类型 | 责任方 | 状态 | 停留时间 | 主动耗时 | 等待耗时 | 等待原因 | 证据 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| frontend-design-review | review | evaluator | unmeasured | unmeasured | unmeasured | unmeasured | missing_instrumentation | current run log lacks stage timing | add stage timing collection |

### 判定原则

评价结论必须先列工程证据，再给分级。证据不足时只能给“未测量”或“无法判定”，不得用主观体验补齐。

节点停留时间不用于简单追责用户等待。评价必须区分用户确认等待、工具执行等待、外部系统等待、上下文缺失等待和 agent 主动执行耗时。

当某个节点长期停留或反复 `unmeasured` 时，优先改进工程可观测性、门禁状态机或上下文路由，而不是扩大 prompt 文案。

## English

### Goal

This standard defines how to evaluate Xiaobai's own capability. Xiaobai is not a single prompt, one agent, or one response; it is an engineering system made of the engine, workspace, loops, agents, harnesses, evaluators, human gates, memory, reports, and Git delivery closure.

The goal is not to judge whether an answer looks good. The goal is to judge whether the system can reliably route work to sources of truth, decompose it into executable stages, preserve evidence, pass gates, complete delivery, and locate failures by concrete stage and reason.

### Evaluation Surface

An evaluation report must cover these objects:

- The `loop-engineering/` engine layer: runtime, schemas, CLI, templates, and tests.
- The `workspace/` operating space: loop specs, project knowledge, agents, connectors, memory, budgets, reports, and local mount templates.
- Orchestrator: whether it resolves the user target, project, repository, background, loop, and execution boundary.
- Generator and harness: whether they have clear inputs, outputs, tool boundaries, and completion conditions.
- Evaluator and human gate: whether they are independent from the generator and can truly block or flag invalid results.
- Memory and reports: whether they can reconstruct task context, decisions, verification, outcomes, and reusable conclusions.
- Git and remote closure: whether branch, commit, remote SHA, worktree status, and uncommitted risk can be proven.

### Evaluation Dimensions

Use these dimensions for scoring or grading:

| Dimension | Required evidence | Failure signal |
| --- | --- | --- |
| Target resolution | User request, target project, target repository, target branch, selected loop | Implementing while the target is ambiguous |
| Source-of-truth routing | `project.yaml`, project `SKILL.md`, target repository `git status`, remote URL | Choosing a repository from memory or guesses |
| Stage contract | Workflow stage, input, output, owner, required checks | A stage has only a name and no verifiable output |
| Gate effectiveness | Evaluator verdict, human gate, verification command, blocking record | Generator self-review is treated as completion |
| Stage dwell time | Stage timing, waiting reason, active time, blocked stage | Claiming efficiency without timing collection |
| Delivery closure | Commit, push, remote SHA, status, test result | Saying "done" without execution evidence |
| Failure recovery | Failure reason, next action, owner, retryable step | Failure is explained only generically |
| Knowledge persistence | Checkpoint, audit, case, index, reusable rule | Long-term value is not persisted |

### Stage Dwell-Time Model

Every workflow stage must be able to record, or explicitly mark, these fields:

| Field | Meaning |
| --- | --- |
| `stageId` | Stage ID matching the workflow stage in the loop spec |
| `stageKind` | Stage kind, such as intake, design, review, coding, human-gate, or pr-readiness |
| `owner` | Current owner, such as orchestrator, generator, evaluator, human, tool, or external-system |
| `status` | `planned`, `running`, `waiting`, `passed`, `failed`, `skipped`, `blocked`, or `unmeasured` |
| `enteredAt` | Time when the stage was entered |
| `firstActionAt` | Time of the first effective action in the stage |
| `exitedAt` | Time when the stage was exited |
| `durationMs` | Total dwell time in the stage |
| `activeMs` | Active execution time |
| `waitingMs` | Waiting time |
| `waitingReason` | Waiting reason, such as `human_input`, `tool_running`, `external_api`, `missing_context`, `approval_required`, or `error_blocker` |
| `evidence` | Commands, files, reports, screenshots, remote SHAs, or logs supporting the stage status |

If real collection data is unavailable, the evaluation report must write `unmeasured` instead of filling estimated values. Missing stage dwell-time collection is itself an observability gap and must become an evaluation finding.

### Runtime Events And Xigua Observability

The runtime should append each `StageExecutionEvent` as one line in `stage-events.jsonl` under loop memory. Existing events must never be overwritten or reordered. The lifecycle is limited to `entered`, `first_action`, `waiting`, `completed`, `failed`, `skipped`, and `blocked`; every record must include `loopId`, `runId`, `taskId`, `stageId`, `stageKind`, `owner`, `event`, `status`, and `timestamp`, with `waitingReason` and `evidence` when applicable.

`WorkflowExecutor` schedules task dependencies, concurrency limits, and event evidence only. It executes host-provided `run()` functions; it does not create Agents, invoke models, or write business repositories. Actual Agent invocation, permissions, and business writes remain host-owned. A stage plan therefore must not be described as real multi-Agent parallel execution unless the host provides a real invocation adapter and corresponding event evidence.

Timing is derived only from real events: `durationMs=exitedAt-enteredAt`; the waiting interval runs from the last `waiting` event to exit or the current observation time; and `activeMs=durationMs-waitingMs`. `human_input`, `tool_running`, `external_api`, `missing_context`, `approval_required`, `error_blocker`, and `dependency_waiting` must remain separately attributed. Never estimate a missing entry or exit event.

Monitoring may display runtime xigua stages not declared in the YAML loop spec when they are observed in the latest run's event metadata, with `stage-events.jsonl` as the evidence source. Without real events, it must not prefill xigua stages or durations and must continue to report `unmeasured`.

The xigua source-consumption `sourceFingerprint` is a stable hash of `sourceCommit`, the `AGENT.md` content hash, and the full source worktree status. `sourceDirty` and `sourceWorktreeStatus` identify the source state that was read; they are not evidence that a business repository was written.

For `Scaffold` with `apiStatus=api_contract_missing`, `continuation.deliveryStatus=scaffold_delivered` means the page directory, route, and static delivery are complete. `nextMode=ApiWiring` carries only pending API contract input. It does not mean automatic resume, automatic integration, or automatic dispatch; later execution must be explicitly started by the user or host.

### Report Format

Evaluation reports must include at least this table:

| Stage | Kind | Owner | Status | Dwell time | Active time | Waiting time | Waiting reason | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| requirement-intake | intake | generator | passed | 120000 | 90000 | 30000 | tool_running | report path | - |

When real timing is unavailable, write it this way:

| Stage | Kind | Owner | Status | Dwell time | Active time | Waiting time | Waiting reason | Evidence | Next action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| frontend-design-review | review | evaluator | unmeasured | unmeasured | unmeasured | unmeasured | missing_instrumentation | current run log lacks stage timing | add stage timing collection |

### Decision Principles

Evaluation conclusions must list engineering evidence before assigning a grade. When evidence is missing, use "unmeasured" or "cannot determine"; do not fill gaps with subjective impressions.

Stage dwell time must not be used to blame user waiting. The evaluation must distinguish waiting for user confirmation, tool execution, external systems, missing context, and active agent execution time.

When a stage repeatedly has long dwell time or remains `unmeasured`, improve engineering observability, the gate state machine, or context routing before expanding prompt wording.
