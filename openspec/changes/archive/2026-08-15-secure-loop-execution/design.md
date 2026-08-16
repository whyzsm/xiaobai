## Context / 背景

当前 `LoopRuntime` 只生成计划，`SimulationRuntime` 只写确定性模拟产物，`HarnessRuntime` 只校验外部提交，`HumanGate` 只在调用方主动调用时检查 GatePass。监控层没有 stage event 真源，因此如实把全部 15 个 workflow 节点标记为 `unmeasured`。

Today, `LoopRuntime` only builds plans, `SimulationRuntime` only writes deterministic simulation artifacts, `HarnessRuntime` only validates external submissions, and `HumanGate` checks GatePasses only when a caller opts in. Monitoring has no stage-event source of truth, so it correctly marks all 15 workflow stages as `unmeasured`.

Memory 可以位于同步的 Obsidian 目录。JSONL 适合本机追加审计，但文件同步不提供跨机器强一致性，因此本设计只能先保证单执行权威实例下的本地闭环。

Memory may live in a synced Obsidian directory. JSONL is suitable for local append-only audit, but file synchronization does not provide strong cross-machine consistency. This design therefore guarantees a local closed loop under one authoritative executor instance first.

## Goals / Non-Goals / 目标与非目标

**Goals / 目标：**

- 让摘要计算、Gate 判定、Harness 校验和 stage event 写入处于同一引擎可信边界。
- Keep digest computation, Gate decisions, Harness validation, and stage-event writes inside one trusted engine boundary.
- 为真实 stage 执行提供最小、可测试、可恢复的状态机。
- Provide a minimal, testable, recoverable state machine for real stage execution.
- 保持 `loop-runtime` 负责规划、`simulation-runtime` 负责模拟、监控负责只读投影。
- Preserve the boundaries where `loop-runtime` plans, `simulation-runtime` simulates, and monitoring performs read-only projection.

**Non-Goals / 非目标：**

- 本变更不建立分布式门禁数据库，也不承诺跨机器同步目录具备即时撤销一致性。
- This change does not build a distributed gate database or promise immediate revocation consistency across synced machines.
- 本变更不开放 Codex CLI 对目标仓的无代理写权限。
- This change does not grant Codex CLI unbrokered write access to target repositories.
- 本变更不自动 commit、push、merge 或 release。
- This change does not automatically commit, push, merge, or release.

## Decisions / 决策

### 1. One secure execution capability / 一个安全执行能力

新增 `execution-runtime` 作为唯一运行入口。它接收已验证的 RuntimePlan、run/task 标识、stage、审批对象和 adapter；它不负责发现或重新规划 Loop。

Add `execution-runtime` as the sole execution entry point. It receives a validated RuntimePlan, run/task identifiers, a stage, approval subjects, and an adapter. It does not perform discovery or re-plan the Loop.

选择独立包而不是扩展 `LoopRuntime`，因为规划必须继续无副作用；也不扩展 `SimulationRuntime`，因为模拟产物不能冒充真实执行证据。

Use a separate package instead of extending `LoopRuntime` because planning must remain side-effect free. Do not extend `SimulationRuntime` into real execution because simulation artifacts must never masquerade as execution evidence.

### 2. Canonical subjects are computed inside HumanGate / 在 HumanGate 内计算规范审批对象

新增 `subjectDigest` 模块：按 `subjectFields` 生成投影，拒绝缺失字段、`undefined`、函数、symbol、bigint、循环引用和非有限数字；对象键按 JCS/UTF-16 规则排序，数组保留顺序，字符串不做隐式 Unicode 或路径归一化，最终对 UTF-8 canonical JSON 计算 SHA-256。

Add a `subjectDigest` module that projects `subjectFields`; rejects missing fields, `undefined`, functions, symbols, bigint, cycles, and non-finite numbers; sorts object keys using JCS/UTF-16 ordering; preserves array order; performs no implicit Unicode or path normalization; and hashes UTF-8 canonical JSON with SHA-256.

GatePass v2 保存 `canonicalization: jcs-v1` 和 `policyDigest`。v1 事件可读但不授权，避免静默信任旧协议。

GatePass v2 stores `canonicalization: jcs-v1` and `policyDigest`. Version 1 events remain readable but never authorize execution, avoiding silent trust in the legacy protocol.

### 3. Gate checks accept stage plus actions / Gate 同时检查节点与动作

`GateCheckInput` 从互斥的 `stageId`/`action` 改为可组合的 `stageId` 与 `actions[]`。HumanGate 对所需 gate 去重，并分别按每个 gate 的 `subjectFields` 计算摘要。

Change `GateCheckInput` from mutually exclusive `stageId`/`action` to composable `stageId` and `actions[]`. HumanGate deduplicates required gates and computes a separate subject digest from each gate's `subjectFields`.

对 action 的检查发生在 engine-owned action adapter 调用前；仅在 stage 开始时检查一次不能替代即时 action 授权。

Action checks occur immediately before invoking an engine-owned action adapter. A one-time check at stage entry does not replace just-in-time action authorization.

### 4. StageEventStore is append-only and run-scoped / StageEventStore 追加写且按运行隔离

新增 `StageEventStore`，默认路径为 `<memoryRoot>/loops/<loopId>/stage-events.jsonl`。事件包含版本、唯一 ID、loop/run/task/stage/attempt、owner、eventType、occurredAt、waitingReason 和 evidence。

Add `StageEventStore` at `<memoryRoot>/loops/<loopId>/stage-events.jsonl`. Events include version, unique ID, loop/run/task/stage/attempt, owner, event type, occurrence time, waiting reason, and evidence.

状态转换为 `entered -> first_action? -> waiting_started/waiting_ended* -> passed|failed|blocked|skipped`。blocked 后重试必须增加 attempt，不能重写历史。

The transition model is `entered -> first_action? -> waiting_started/waiting_ended* -> passed|failed|blocked|skipped`. A retry after a terminal event increments the attempt and never rewrites history.

### 5. Projection is pure and conservative / 投影纯函数且保守

计时投影独立为纯函数，由测试固定边界。`durationMs` 是 entered 到 terminal 的墙钟差；`waitingMs` 是成对等待区间总和；`activeMs = durationMs - waitingMs`。缺失、倒序或未闭合事件返回 invalid/unmeasured，不补零、不估算。

Timing projection is a pure function with test-fixed boundaries. `durationMs` is wall-clock time from entered to terminal, `waitingMs` is the sum of paired waiting intervals, and `activeMs = durationMs - waitingMs`. Missing, out-of-order, or unclosed events return invalid/unmeasured rather than zero or estimates.

### 6. Codex CLI is a read-only pilot adapter / Codex CLI 是只读 pilot adapter

首个 adapter 使用本机已验证的 `codex exec` 参数：显式 `--cd`、`--sandbox read-only`、`--json`、`--output-schema`、`--ephemeral`。它只用于 intake、review、verification 等只读节点。

The first adapter uses locally verified `codex exec` arguments: explicit `--cd`, `--sandbox read-only`, `--json`, `--output-schema`, and `--ephemeral`. It is limited to read-only intake, review, and verification stages.

需要 workspace mutation 的节点在 action broker 完成前返回 `unsupported_mutation_stage`。这比仅靠 prompt 或事后 diff 声称受控更诚实。

Stages requiring workspace mutation return `unsupported_mutation_stage` until an action broker exists. This is more honest than claiming control through prompting or post-hoc diffs.

### 7. Local authority is explicit / 显式限定本地权威

ExecutionRuntime 在 run 级创建本机独占锁并记录 executor instance。锁可防止本机并发写入，但不宣称解决跨机器文件同步冲突。监控必须显示 authority scope。

ExecutionRuntime creates a local exclusive lock per run and records the executor instance. The lock prevents concurrent local writers but does not claim to solve cross-machine file-sync conflicts. Monitoring must expose the authority scope.

## Risks / Trade-offs / 风险与权衡

- `[Risk]` Codex CLI pilot 不能执行写节点。`[Mitigation]` 明确阻断并保留 adapter 协议，后续以 engine-owned action broker 扩展。
- `[风险]` Codex CLI pilot 无法执行写节点。`[缓解]` 明确阻断并保留 adapter 协议，后续通过引擎持有的 action broker 扩展。
- `[Risk]` GatePass v1 失去执行能力。`[Mitigation]` 保留读取与审计，要求重新审批生成 v2 pass。
- `[风险]` GatePass v1 失去执行能力。`[缓解]` 保留读取与审计，要求重新审批生成 v2 pass。
- `[Risk]` Wall-clock adjustments can distort durations. `[Mitigation]` validate non-negative ordered timestamps and surface invalid streams rather than correcting them silently.
- `[风险]` 系统时钟调整可能扭曲耗时。`[缓解]` 校验时间非负且有序，发现异常时报告 invalid，不静默修正。
- `[Risk]` Synced JSONL is not a distributed authority. `[Mitigation]` scope v1 to one executor instance and block production multi-machine claims.
- `[风险]` 同步 JSONL 不是分布式权威存储。`[缓解]` v1 限定单 executor instance，并阻止生产级多机器声明。

## Migration Plan / 迁移计划

1. 新增 canonical subject 与 GatePass v2，保持 v1 只读审计。
2. Add canonical subjects and GatePass v2 while retaining v1 for read-only audit.
3. 新增 StageEventStore 与纯投影，先在 simulation fixture 中验证。
4. Add StageEventStore and pure projection, validating them with simulation fixtures first.
5. 新增 ExecutionRuntime 与假 adapter 测试，再接入 Codex CLI read-only adapter。
6. Add ExecutionRuntime with fake-adapter tests, then integrate the read-only Codex CLI adapter.
7. 切换监控读取真实事件；没有事件的节点继续 `unmeasured`。
8. Switch monitoring to real events while leaving stages without events as `unmeasured`.
9. 回滚时移除 execute 入口并停止写新事件；已有 JSONL 保留审计，不删除。
10. On rollback, remove the execute entry point and stop writing new events; retain existing JSONL for audit without deletion.

## Open Questions / 开放问题

- 生产多机器 executor 最终使用数据库、远端服务还是单写 lease 服务作为 GatePass 权威，需要下一份变更决定。
- A future change must decide whether production multi-machine execution uses a database, remote service, or single-writer lease service as GatePass authority.
- 写操作 broker 的最小动作集合与目标仓回滚协议不在本变更中确定。
- This change does not define the minimum mutation-broker action set or target-repository rollback protocol.
