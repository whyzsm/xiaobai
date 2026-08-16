## ADDED Requirements

### Requirement: Unified task envelope / 统一任务信封
The system SHALL represent every AI-initiated unit of work as a `TaskEnvelope` with a stable task id, project route, repository target, requested actions, provider mode, workspace lease reference, gate requirements, prompt digest, and append-only event stream.

系统必须把每个由 AI 发起的工作单元表示为 `TaskEnvelope`，其中包含稳定 task id、项目路由、目标仓库、请求动作、provider 模式、workspace lease 引用、门禁要求、提示词摘要和追加式事件流。

#### Scenario: Task created from any entry point / 任意入口创建任务
- **WHEN** CLI, MCP, ACP, or HTTP submits the same task request
- **THEN** the system creates the same logical `TaskEnvelope` shape and records the entry point as metadata instead of changing task semantics
- **当** CLI、MCP、ACP 或 HTTP 提交同一个任务请求时
- **则** 系统创建相同逻辑形态的 `TaskEnvelope`，并把入口类型记录为元数据而不是改变任务语义

#### Scenario: Task state is explicit / 任务状态显式
- **WHEN** a task moves through creation, workspace preparation, execution, verification, promotion, or failure
- **THEN** the system records one of `created`, `prepared`, `leased`, `running`, `submitted`, `verifying`, `ready_to_merge`, `merged`, `blocked`, or `failed`
- **当** 任务经过创建、workspace 准备、执行、验证、交付提升或失败阶段时
- **则** 系统记录 `created`、`prepared`、`leased`、`running`、`submitted`、`verifying`、`ready_to_merge`、`merged`、`blocked` 或 `failed` 之一

### Requirement: Entry points share one task runtime / 入口共享同一个任务 runtime
CLI, MCP, ACP, and HTTP entry points SHALL delegate task creation, claiming, execution, submission, status lookup, and cancellation to one task runtime instead of implementing separate behavior per AI product.

CLI、MCP、ACP 和 HTTP 入口必须把任务创建、领取、执行、提交、状态查询和取消委托给同一个 task runtime，不得按 AI 产品分别实现不同语义。

#### Scenario: CLI and MCP produce equivalent task state / CLI 与 MCP 产生等价任务状态
- **WHEN** an operator creates a task through the CLI and another operator creates an equivalent task through MCP
- **THEN** both tasks use the same validation, route resolution, gate checks, lease policy, and event types
- **当** 操作者通过 CLI 创建任务，另一个操作者通过 MCP 创建等价任务时
- **则** 两个任务使用相同的校验、路由解析、门禁检查、lease 策略和事件类型

#### Scenario: Unsupported entry point operation fails closed / 不支持的入口操作关闭失败
- **WHEN** an entry point requests an operation that the task runtime does not expose
- **THEN** the system rejects the request with a structured `unsupported_operation` reason and performs no side effect
- **当** 入口请求 task runtime 未暴露的操作时
- **则** 系统以结构化 `unsupported_operation` 原因拒绝请求，且不产生副作用

### Requirement: Provider registry controls AI execution / Provider 注册表控制 AI 执行
The system SHALL select AI executors through a provider registry that declares provider id, executable or transport, supported modes, sandbox assumptions, writable capability, output schema, timeout, and required verification.

系统必须通过 provider registry 选择 AI 执行器；registry 必须声明 provider id、可执行程序或传输方式、支持模式、沙箱假设、可写能力、输出 schema、超时和必需验证。

#### Scenario: Managed provider is launched by Xiaobai / 小白启动 managed provider
- **WHEN** a task selects a managed Codex, Claude, or Gemini provider
- **THEN** Xiaobai launches the provider with an explicit cwd, lease-scoped workspace, configured sandbox, non-interactive output, and structured evidence capture
- **当** 任务选择 managed Codex、Claude 或 Gemini provider 时
- **则** 小白使用显式 cwd、lease 作用域 workspace、配置的 sandbox、非交互输出和结构化证据采集启动 provider

#### Scenario: Client provider submits externally produced work / Client provider 提交外部完成的工作
- **WHEN** an external AI claims a task in client mode and submits a result
- **THEN** Xiaobai treats the submission as untrusted input, verifies it through Harness and evaluator gates, and records that host sandbox enforcement was external
- **当** 外部 AI 以 client 模式领取任务并提交结果时
- **则** 小白把提交内容视为不可信输入，通过 Harness 与 evaluator 门禁验证，并记录 host sandbox 由外部保证

#### Scenario: Provider lacks required capability / Provider 缺少必需能力
- **WHEN** a task requires repository mutation and the selected provider is registered as read-only
- **THEN** execution is blocked before provider launch with a capability mismatch reason
- **当** 任务需要修改仓库但所选 provider 注册为只读时
- **则** 系统在启动 provider 前阻断执行，并给出能力不匹配原因

### Requirement: Engine-owned prompt assembly / 引擎持有提示词装配
The system SHALL assemble provider prompts from task data, project route, Xiaoneng background context, workflow stage contract, gate constraints, and output schema inside Xiaobai before invoking any provider.

系统必须在小白内部根据任务数据、项目路由、小能背景上下文、workflow 节点契约、门禁约束和输出 schema 装配 provider 提示词，然后才能调用任何 provider。

#### Scenario: Xiaoneng background enters every provider prompt / 小能背景进入每个 provider 提示词
- **WHEN** a T-MAX task resolves the Xiaoneng background context
- **THEN** Codex, Claude, Gemini, ACP, MCP, and client-mode prompts receive the same engine-selected background digest and document metadata
- **当** T-MAX 任务解析到小能背景上下文时
- **则** Codex、Claude、Gemini、ACP、MCP 和 client-mode 提示词接收相同的引擎选择背景摘要与文档元数据

#### Scenario: Provider wrapper cannot change task truth / Provider 包装层不能改变任务真源
- **WHEN** a provider adapter adds provider-specific command syntax or system instructions
- **THEN** it MUST preserve the engine-owned task subject, context digest, gate constraints, and output schema
- **当** provider adapter 增加 provider 专属命令语法或系统指令时
- **则** 它必须保留引擎持有的任务对象、上下文摘要、门禁约束和输出 schema

### Requirement: Git worktree leases isolate writers / Git worktree lease 隔离写入者
The worktree manager SHALL create, claim, heartbeat, recover, and release real Git worktree leases for writable tasks, with one writer per lease and a unique branch for each task.

worktree manager 必须为可写任务创建、领取、心跳、恢复和释放真实 Git worktree lease；每个 lease 只允许一个写入者，并为每个任务使用唯一 branch。

#### Scenario: Writable task gets isolated branch and path / 可写任务获得隔离 branch 与路径
- **WHEN** a writable task is prepared for a target repository
- **THEN** the system runs the equivalent of `git worktree add` for a deterministic lease path and unique branch before provider execution
- **当** 可写任务为目标仓库准备 workspace 时
- **则** 系统在 provider 执行前执行等价 `git worktree add` 操作，生成确定性的 lease 路径和唯一 branch

#### Scenario: Occupied lease rejects second writer / 已占用 lease 拒绝第二个写入者
- **WHEN** a second writer tries to claim an active lease for the same task worktree
- **THEN** the claim fails with `lease_already_owned` and the existing writer metadata remains unchanged
- **当** 第二个写入者尝试领取同一个任务 worktree 的活跃 lease 时
- **则** 领取失败并返回 `lease_already_owned`，且已有写入者元数据保持不变

#### Scenario: Dirty worktree is not deleted automatically / 脏 worktree 不自动删除
- **WHEN** a lease expires, fails, or is released while the worktree contains uncommitted or untracked changes
- **THEN** the system preserves the worktree, marks the lease `dirty_retained`, and requires explicit human action before deletion
- **当** lease 过期、失败或释放时，如果 worktree 包含未提交或未跟踪变更
- **则** 系统保留该 worktree，把 lease 标记为 `dirty_retained`，并要求明确人工操作后才能删除

### Requirement: Concurrent AI writes are branch-isolated / 多 AI 写入通过 branch 隔离
The system SHALL allow multiple AI providers to work on the same business repository concurrently only when each writer uses a separate worktree lease and branch.

系统必须只在每个写入者使用独立 worktree lease 和 branch 时，允许多个 AI provider 并发处理同一个业务仓库。

#### Scenario: Two providers modify one repository concurrently / 两个 provider 并发修改同一仓库
- **WHEN** Codex and Claude execute two writable tasks against the same repository at the same time
- **THEN** each provider receives a different worktree path and branch, and neither provider can write to the other's lease
- **当** Codex 和 Claude 同时对同一个仓库执行两个可写任务时
- **则** 每个 provider 获得不同的 worktree 路径和 branch，且不能写入对方的 lease

#### Scenario: Same-file conflict blocks promotion / 同文件冲突阻断交付提升
- **WHEN** two completed task branches change overlapping lines that cannot be merged cleanly
- **THEN** the merge queue blocks promotion, preserves both branches, and records conflict evidence
- **当** 两个已完成任务 branch 修改无法干净合并的重叠行时
- **则** merge queue 阻断交付提升，保留两个 branch，并记录冲突证据

### Requirement: Repository mutations are brokered / 仓库写操作受 broker 控制
The system SHALL route repository mutation, push, pull request creation, merge, destructive cleanup, and protected branch changes through engine-owned brokers that enforce gates and record evidence.

系统必须通过引擎持有的 broker 处理仓库修改、push、PR 创建、merge、破坏性清理和受保护 branch 变更；broker 必须执行门禁并记录证据。

#### Scenario: Provider edits only inside leased workspace / Provider 只在 lease workspace 内编辑
- **WHEN** a managed provider performs file edits
- **THEN** the provider process is scoped to the leased worktree and the broker rejects mutation evidence outside the lease root
- **当** managed provider 执行文件编辑时
- **则** provider 进程被限制在 leased worktree 内，且 broker 拒绝 lease root 之外的修改证据

#### Scenario: Push requires authorization / Push 需要授权
- **WHEN** a task requests pushing a branch to a remote
- **THEN** the repository action broker checks the required GatePass, validates the branch belongs to the task lease, executes the push, and records command evidence
- **当** 任务请求把 branch push 到远端时
- **则** repository action broker 检查必需 GatePass，校验 branch 属于该任务 lease，执行 push，并记录命令证据

#### Scenario: Unauthorized merge fails closed / 未授权 merge 关闭失败
- **WHEN** a provider or entry point requests merge without a valid merge gate and promotion plan
- **THEN** the system rejects the merge request and performs no protected branch mutation
- **当** provider 或入口在没有有效 merge 门禁和 promotion plan 的情况下请求 merge 时
- **则** 系统拒绝 merge 请求，且不修改受保护 branch

### Requirement: Verification gates precede promotion / 验证门禁先于交付提升
A task branch SHALL be promoted only after Harness validation, independent evaluator review, required focused checks, diff inspection, and repository policy checks pass.

任务 branch 只有在 Harness 校验、独立 evaluator 评审、必需聚焦检查、diff 检查和仓库策略检查全部通过后，才能进入交付提升。

#### Scenario: Provider reports success but tests fail / Provider 报告成功但测试失败
- **WHEN** a provider submission claims completion but the configured focused check fails
- **THEN** the task status becomes `failed` or `blocked`, and the branch is not marked `ready_to_merge`
- **当** provider submission 声称完成但配置的聚焦检查失败时
- **则** 任务状态变为 `failed` 或 `blocked`，且 branch 不标记为 `ready_to_merge`

#### Scenario: Independent evaluator rejects change / 独立 evaluator 拒绝变更
- **WHEN** the implementation provider completes but the evaluator rejects correctness, safety, or evidence quality
- **THEN** the promotion plan is blocked and the rejection is linked to evaluator evidence
- **当** 实现 provider 完成但 evaluator 拒绝正确性、安全性或证据质量时
- **则** promotion plan 被阻断，并关联 evaluator 证据

### Requirement: DeepSeek Harness ACP integration / DeepSeek Harness ACP 集成
The system SHALL expose an ACP stdio server that lets DeepSeek Harness launch Xiaobai as a subagent provider while preserving Xiaobai task runtime ownership.

系统必须暴露 ACP stdio server，让 DeepSeek Harness 能以 subagent provider 方式启动小白，同时保留小白对 task runtime 的所有权。

#### Scenario: Harness starts Xiaobai over ACP / Harness 通过 ACP 启动小白
- **WHEN** DeepSeek Harness starts the Xiaobai ACP command
- **THEN** Xiaobai accepts ACP messages over stdio, maps them to `TaskEnvelope` operations, streams structured progress, and returns a Harness-compatible result
- **当** DeepSeek Harness 启动小白 ACP 命令时
- **则** 小白通过 stdio 接收 ACP 消息，把消息映射为 `TaskEnvelope` 操作，流式输出结构化进度，并返回 Harness 兼容结果

#### Scenario: ACP cannot bypass gates / ACP 不能绕过门禁
- **WHEN** an ACP client requests a protected action
- **THEN** the same gate, lease, broker, and verification checks apply as CLI and MCP entry points
- **当** ACP client 请求受保护动作时
- **则** 系统执行与 CLI、MCP 入口相同的门禁、lease、broker 和验证检查

### Requirement: Provider support levels are evidence-based / Provider 支持等级基于证据
The system SHALL distinguish `supported`, `experimental`, and `client_only` provider support levels based on real smoke tests and recorded capability evidence.

系统必须根据真实冒烟测试和已记录能力证据，区分 `supported`、`experimental` 和 `client_only` provider 支持等级。

#### Scenario: Codex Claude and Gemini are promoted after smoke tests / Codex Claude Gemini 经冒烟测试后升级
- **WHEN** Codex, Claude, or Gemini completes writable smoke tasks through the provider runtime with valid evidence
- **THEN** the provider registry may mark that provider `supported` for the verified mode and sandbox profile
- **当** Codex、Claude 或 Gemini 通过 provider runtime 完成带有效证据的可写冒烟任务时
- **则** provider registry 可以把该 provider 在已验证模式和 sandbox profile 下标记为 `supported`

#### Scenario: ZCode or WorkBuddy is not assumed supported / 不假设 ZCode 或 WorkBuddy 已支持
- **WHEN** ZCode or WorkBuddy has not completed a local smoke test through Xiaobai
- **THEN** the registry keeps it `experimental` or `client_only` and the documentation must not claim full managed support
- **当** ZCode 或 WorkBuddy 尚未通过小白完成本机冒烟测试时
- **则** registry 保持其为 `experimental` 或 `client_only`，文档不得宣称完整 managed 支持

### Requirement: Audit and recovery are append-only / 审计与恢复追加记录
The system SHALL record task events, provider events, lease events, broker decisions, verification results, and promotion decisions in append-only logs that can reconstruct a task after crashes or handoffs.

系统必须以追加式日志记录 task 事件、provider 事件、lease 事件、broker 决策、验证结果和 promotion 决策，以便在崩溃或交接后重建任务。

#### Scenario: Crash during provider execution / Provider 执行期间崩溃
- **WHEN** the host crashes or the provider process exits unexpectedly during `running`
- **THEN** recovery reconstructs the last known task state, marks the lease stale or failed according to heartbeat policy, and preserves any dirty worktree
- **当** host 崩溃或 provider 进程在 `running` 状态异常退出时
- **则** 恢复流程重建最后已知任务状态，根据心跳策略把 lease 标记为 stale 或 failed，并保留任何脏 worktree

#### Scenario: Handoff reads complete evidence / 交接读取完整证据
- **WHEN** another AI or human resumes a task
- **THEN** the system exposes task status, provider transcript summary, changed files, verification results, lease metadata, and next required action
- **当** 另一个 AI 或人工继续某个任务时
- **则** 系统暴露任务状态、provider transcript 摘要、变更文件、验证结果、lease 元数据和下一步必需动作
