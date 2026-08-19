## ADDED Requirements

新增要求 / Chinese added requirements

### Requirement: StandardPage execution is bound to locked Xiaoneng evidence / 标准页执行必须绑定已锁定的小能证据
The StandardPage workflow SHALL require a task-scoped context lock and the required task artifacts before any implementation, verification, evaluation, or delivery stage can invoke an executor. Artifacts MUST be schema-valid and MUST bind to the locked context and selected evidence bundles.

标准页 workflow 在实现、校验、评估或交付阶段调用 executor 前，必须要求任务级上下文锁和必需任务产物。产物必须通过 schema 校验，并且必须绑定到已锁定上下文和选定证据包。

#### Scenario: Missing context lock blocks execution / 缺少上下文锁时阻断执行
- **WHEN** a StandardPage stage is executed without a task-scoped context lock
- **THEN** execution returns `blocked` or `failed` before the adapter is invoked and records `XIAONENG_CONTEXT_LOCK_REQUIRED`
- **当** 标准页阶段在没有任务级上下文锁时执行
- **则** 执行在调用 adapter 前返回 `blocked` 或 `failed`，并记录 `XIAONENG_CONTEXT_LOCK_REQUIRED`

#### Scenario: Tampered artifact blocks execution / 产物被篡改时阻断执行
- **WHEN** `page-contract.json` or `import-rule.json` has invalid schema, a mismatched digest, or a source outside the selected evidence bundle
- **THEN** execution fails closed and the adapter is not invoked
- **当** `page-contract.json` 或 `import-rule.json` schema 无效、摘要不匹配或来源不在选定证据包内
- **则** 执行关闭失败，且不调用 adapter

### Requirement: StandardPage stages expose real timing / 标准页阶段必须暴露真实计时
The workflow SHALL expose `stageTiming` derived only from valid StageEvents for every executed workflow stage. The projection MUST include `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, `waitingMs`, `waitingReason`, `status`, and `evidence`, and MUST mark missing instrumentation as `unmeasured`.

workflow 必须为每个实际执行的节点暴露仅由有效 StageEvent 推导的 `stageTiming`。投影必须包含 `enteredAt`、`firstActionAt`、`exitedAt`、`durationMs`、`activeMs`、`waitingMs`、`waitingReason`、`status` 和 `evidence`，缺少埋点时必须标记为 `unmeasured`。

#### Scenario: Completed stage is measured / 已完成节点可测量
- **WHEN** a stage has a valid entered, first_action, waiting interval, and terminal event sequence
- **THEN** the result exposes duration and active/waiting milliseconds without estimating from wall-clock files or conversation time
- **当** 节点具有有效的 entered、first_action、等待区间和终止事件序列
- **则** 结果暴露 duration 以及主动/等待毫秒数，不从文件时间或对话时间估算

#### Scenario: Simulation remains unmeasured / 模拟运行保持未测量
- **WHEN** a workflow stage exists only in simulation and has no execution events
- **THEN** the stage is reported as `unmeasured` with `waitingReason: missing_instrumentation`
- **当** workflow 节点只存在于模拟运行且没有执行事件
- **则** 节点报告为 `unmeasured`，等待原因为 `missing_instrumentation`
