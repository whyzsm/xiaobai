## Why / 为什么

当前 Loop Engineering 已能规划 workflow、校验 Harness 结果并记录 GatePass，但没有可信的真实执行入口：门禁检查可被外部 executor 跳过，`subjectDigest` 由调用方自行计算，workflow 节点也没有真实计时事件。这使系统只能证明“可校验”，不能证明受保护动作一定经过门禁，也不能评价节点执行与等待效率。

Loop Engineering can plan workflows, validate Harness results, and record GatePass events, but it has no trusted execution entry point. An external executor can skip gate checks, callers compute `subjectDigest` themselves, and workflow stages emit no real timing events. The system can therefore prove that results are checkable, but not that protected actions always pass through gates or that stage execution and waiting time are measurable.

## What Changes / 变更内容

- 在引擎内根据 gate 的 `subjectFields` 生成版本化、稳定的审批对象摘要，并将 gate 策略绑定到 GatePass。
- Add versioned, deterministic subject digest generation inside the engine from each gate's `subjectFields`, and bind the gate policy to each GatePass.
- 新增统一 `ExecutionRuntime`，把 workflow stage 与受保护 action 的执行集中到同一 fail-closed 入口。
- Add a unified `ExecutionRuntime` that routes workflow stages and protected actions through one fail-closed entry point.
- 新增 append-only stage event 协议，按 run、task、stage 和 attempt 记录状态、主动执行、等待原因与证据。
- Add an append-only stage event protocol scoped by run, task, stage, and attempt, covering state, active execution, waiting reason, and evidence.
- 接入首个真实 executor adapter；外部执行结果仍必须通过 Harness，受保护操作仍由引擎 GateGuard 授权。
- Integrate the first real executor adapter while keeping Harness validation and protected-operation authorization inside the engine GateGuard.
- 让监控层只从真实 stage events 投影节点停留时间；缺失或无效事件继续显示 `unmeasured`。
- Make monitoring project stage dwell time only from real stage events; missing or invalid event streams remain `unmeasured`.
- **BREAKING**：执行型 Gate API 不再信任调用方提供的裸 `subjectDigest`，改为接收审批对象或受控快照。
- **BREAKING**: Enforcement Gate APIs no longer trust a caller-provided raw `subjectDigest`; they accept the approval subject or a controlled snapshot instead.

## Capabilities / 能力

### New Capabilities / 新增能力

- `secure-loop-execution`: 定义稳定审批摘要、统一执行入口、强制 GateGuard、Harness 验证、节点事件和计时投影的端到端契约。
- `secure-loop-execution`: Defines the end-to-end contract for deterministic approval digests, unified execution, mandatory GateGuard and Harness checks, stage events, and timing projection.

### Modified Capabilities / 修改能力

无。仓库当前没有已归档的 OpenSpec capability；现有 runtime 行为由本变更首次纳入 OpenSpec 契约。

None. The repository has no archived OpenSpec capabilities yet; this change brings the existing runtime behavior under an OpenSpec contract for the first time.

## Impact / 影响

- 引擎：`human-gate`、新增 execution runtime、共享类型、CLI、simulation runtime 与测试。
- Engine: `human-gate`, a new execution runtime, shared types, CLI, simulation runtime, and tests.
- 运行空间：GatePass 与 stage event 的 Memory JSONL、监控快照和中英双语说明。
- Operating space: GatePass and stage-event Memory JSONL, monitoring snapshots, and bilingual documentation.
- 接口：Gate 授权/检查输入、workflow 执行命令和 executor adapter 协议。
- Interfaces: Gate grant/check inputs, workflow execution commands, and the executor adapter protocol.
- 依赖：首个 adapter 使用本机 Codex CLI；引擎协议不绑定具体模型供应商。
- Dependencies: The first adapter uses the local Codex CLI while the engine protocol remains provider-neutral.
