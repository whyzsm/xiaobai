# secure-loop-execution Specification

## Purpose
TBD - created by archiving change secure-loop-execution. Update Purpose after archive.
## Requirements
### Requirement: Engine-owned canonical gate subjects / 引擎持有的门禁对象规范化
The engine SHALL accept the approval subject as JSON data, SHALL project exactly the configured `subjectFields`, SHALL reject missing or unsupported values, and SHALL generate the digest with a versioned deterministic JSON canonicalization algorithm and SHA-256.

引擎必须以 JSON 数据接收审批对象，必须严格投影配置的 `subjectFields`，必须拒绝缺失字段或不支持的值，并必须使用版本化的确定性 JSON 规范化算法和 SHA-256 生成摘要。

#### Scenario: Object key order does not change the digest / 对象键顺序不改变摘要
- **WHEN** two approval subjects contain the same JSON values with different object key insertion orders
- **THEN** the engine produces the same canonical subject and digest
- **当** 两个审批对象包含相同 JSON 值但对象键插入顺序不同时
- **则** 引擎生成相同的规范对象和摘要

#### Scenario: Missing configured field fails closed / 缺少配置字段时关闭失败
- **WHEN** a gate declares a subject field that is absent from the approval subject
- **THEN** grant and check reject the subject without creating or accepting a GatePass
- **当** gate 声明的审批字段未出现在审批对象中时
- **则** 授权和检查拒绝该对象，且不创建或接受 GatePass

#### Scenario: Arrays preserve business order / 数组保留业务顺序
- **WHEN** two subjects differ only in array element order
- **THEN** the engine produces different digests unless the field contract explicitly defines set semantics
- **当** 两个审批对象仅数组元素顺序不同时
- **则** 除非字段契约显式声明集合语义，否则引擎生成不同摘要

### Requirement: GatePass binds subject and policy / GatePass 绑定审批对象与策略
Every enforceable GatePass SHALL record the canonicalization version, subject digest, and a digest of the gate policy that authorized it. A pass created under an older or changed policy SHALL remain auditable but SHALL NOT authorize execution.

每个可执行 GatePass 必须记录规范化版本、审批对象摘要以及授权 gate 策略的摘要。在旧策略或已变化策略下创建的通行证必须保留审计能力，但不得授权执行。

#### Scenario: Subject field policy changes / 审批字段策略变化
- **WHEN** `subjectFields`, protected action, reviewers, required evidence, or expiry policy changes after approval
- **THEN** the old GatePass is blocked because its policy digest no longer matches
- **当** 审批后 `subjectFields`、受保护动作、审批人、必需证据或有效期策略发生变化时
- **则** 旧 GatePass 因策略摘要不匹配而被阻断

#### Scenario: Legacy pass is not executable / 旧版通行证不可执行
- **WHEN** the store contains a GatePass without the current canonicalization and policy metadata
- **THEN** the event remains readable for audit and the gate decision is blocked
- **当** 存储中存在缺少当前规范化与策略元数据的 GatePass 时
- **则** 事件仍可用于审计，但门禁判定为阻断

### Requirement: Unified fail-closed execution entry / 统一关闭失败执行入口
The engine SHALL expose one execution runtime for workflow stages and protected actions. It SHALL resolve stage dependencies, compute gate subjects inside the engine, check all required stage and action gates, and refuse to invoke an adapter when any prerequisite is not satisfied.

引擎必须为 workflow 节点和受保护动作提供唯一执行 runtime。它必须解析节点依赖、在引擎内计算门禁对象、检查所有节点与动作门禁，并在任一前置条件不满足时拒绝调用 adapter。

#### Scenario: Stage gate is missing / 节点门禁缺失
- **WHEN** a protected stage is requested without an active pass for the current run, task, stage, subject, and policy
- **THEN** execution returns `blocked`, records evidence, and never invokes the executor adapter
- **当** 当前 run、task、stage、审批对象和策略没有有效通行证却请求受保护节点时
- **则** 执行返回 `blocked`、记录证据，且绝不调用 executor adapter

#### Scenario: Stage and action gates are combined / 合并节点与动作门禁
- **WHEN** a stage invocation requests one or more protected actions
- **THEN** the runtime checks the union of stage gates and action gates before each corresponding side effect
- **当** 一个节点调用请求一个或多个受保护动作时
- **则** runtime 在每个对应副作用前检查节点门禁与动作门禁的并集

#### Scenario: Gate store cannot be trusted / 门禁存储不可信
- **WHEN** the GatePass store is unreadable, malformed, stale according to its authority contract, or otherwise unavailable
- **THEN** the runtime blocks the protected operation
- **当** GatePass 存储不可读、格式损坏、按权威协议判定为陈旧或不可用时
- **则** runtime 阻断受保护操作

### Requirement: Executor output passes Harness validation / Executor 输出通过 Harness 校验
An automatic stage SHALL be considered passed only when its adapter returns a structured run submission that passes the configured Harness. A failed Harness result SHALL fail the stage even if the external process exits successfully.

自动节点只有在 adapter 返回的结构化运行结果通过配置 Harness 后才能视为通过。即使外部进程成功退出，Harness 失败也必须使节点失败。

#### Scenario: External process succeeds with invalid evidence / 外部进程成功但证据无效
- **WHEN** an executor exits with code zero but omits a completion condition, required output, or evidence item
- **THEN** the execution runtime marks the stage failed and does not unlock dependent stages
- **当** executor 以退出码零结束但缺少完成条件、必需输出或证据项时
- **则** execution runtime 将节点标记为失败，且不解锁后续节点

### Requirement: Append-only workflow stage events / 追加式 workflow 节点事件
The execution runtime SHALL append versioned stage events scoped by `loopId`, `runId`, `taskId`, `stageId`, and `attempt`. Events SHALL record owner, event type, timestamp, waiting reason when applicable, and evidence.

execution runtime 必须追加按 `loopId`、`runId`、`taskId`、`stageId` 和 `attempt` 隔离的版本化节点事件。事件必须记录责任方、事件类型、时间戳、适用时的等待原因和证据。

#### Scenario: Human approval waiting is separated / 人工审批等待被单独归因
- **WHEN** a stage cannot continue because human approval is required
- **THEN** the runtime appends a waiting event with `waitingReason: approval_required` and does not count that interval as active execution
- **当** 节点因需要人工审批而无法继续时
- **则** runtime 追加 `waitingReason: approval_required` 的等待事件，且该时间段不计入主动执行

#### Scenario: Retry creates a new attempt / 重试创建新 attempt
- **WHEN** a failed or blocked stage is retried
- **THEN** the runtime appends events under a new attempt number without rewriting the previous attempt
- **当** 失败或阻断节点被重试时
- **则** runtime 在新的 attempt 编号下追加事件，且不改写之前的 attempt

### Requirement: Timing is projected only from valid events / 计时仅从有效事件投影
Monitoring SHALL derive `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, `waitingMs`, `waitingReason`, status, and evidence from valid stage events. It SHALL NOT estimate stage timing from file timestamps, command duration, conversation time, or simulation-only stages.

监控必须从有效节点事件投影 `enteredAt`、`firstActionAt`、`exitedAt`、`durationMs`、`activeMs`、`waitingMs`、`waitingReason`、状态和证据。监控不得根据文件时间、命令耗时、对话时间或仅模拟阶段估算节点计时。

#### Scenario: No events exist for a configured stage / 配置节点没有事件
- **WHEN** a workflow stage has no valid event stream for the selected run and attempt
- **THEN** monitoring reports that stage as `unmeasured` with `missing_instrumentation`
- **当** 所选 run 与 attempt 下的 workflow 节点没有有效事件流时
- **则** 监控将该节点报告为 `unmeasured`，等待原因为 `missing_instrumentation`

#### Scenario: Event order is invalid / 事件顺序无效
- **WHEN** stage events contain impossible or incomplete transitions
- **THEN** monitoring reports the affected attempt as unmeasured or invalid and includes the event-log evidence instead of inventing durations
- **当** 节点事件包含不可能或不完整的状态转换时
- **则** 监控将受影响 attempt 报告为未测量或无效，并给出事件日志证据而不编造耗时

### Requirement: Safe first real executor adapter / 安全的首个真实 executor adapter
The first Codex CLI adapter SHALL execute only stages that the host can contain without exposing unbrokered protected side effects. It SHALL use an explicit working directory, non-interactive structured output, an explicit sandbox, and ephemeral execution. Unsupported mutation stages SHALL be blocked rather than silently downgraded.

首个 Codex CLI adapter 只能执行 host 能够约束且不会暴露未代理受保护副作用的节点。它必须使用显式工作目录、非交互结构化输出、显式 sandbox 和临时会话。未支持的写入节点必须被阻断，不得静默降级。

#### Scenario: Read-only evaluator stage runs / 只读 evaluator 节点执行
- **WHEN** an eligible evaluator stage is executed through the Codex CLI adapter
- **THEN** the adapter runs Codex in read-only mode and returns a structured Harness submission
- **当** 合格的 evaluator 节点通过 Codex CLI adapter 执行时
- **则** adapter 以只读模式运行 Codex，并返回结构化 Harness submission

#### Scenario: Unbrokered mutation is requested / 请求未代理写操作
- **WHEN** a stage requires workspace mutation but no engine-owned action broker is configured
- **THEN** the adapter refuses to start and the stage is blocked with an explicit reason
- **当** 节点需要修改 workspace 但未配置引擎持有的 action broker 时
- **则** adapter 拒绝启动，节点以明确原因被阻断

