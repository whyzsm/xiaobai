## Why / 为什么

当前拉取的实现已经接通标准页 Loop、Harness、Provider 和小能证据，但部分入口仍可绕过统一 Gate Check，StandardPage 上下文锁和产物校验不够严格，节点计时没有进入执行结果，摘要格式也存在多个实现。现在需要把这些骨架能力收敛为可阻断、可审计、可验证的执行闭环。

The pulled implementation connects the standard-page Loop, Harness, providers, and Xiaoneng evidence, but some entry points can still bypass the unified Gate Check. StandardPage context locks and artifact validation are not strict enough, stage timing is not exposed in execution results, and digest formats have multiple implementations. This change closes those gaps into a blocking, auditable, verifiable execution loop.

## What Changes / 变更内容

- 在 CLI、MCP、client submission 和 managed stage execution 入口复用同一 Gate Check 服务。
- 对 `ane-standard-page` 强制要求上下文锁和四类任务产物，并校验 schema、digest、来源 commit 与 evidence bundle。
- 从有效 StageEvent 生成并暴露 `stageTiming`，区分主动执行和等待时间。
- 提供统一的稳定 JSON 序列化和版本化 SHA-256 digest API，供 Gate、Provider、Context 和 artifact 使用。
- 补充入口绕过、锁缺失、产物篡改、计时投影和 digest 稳定性的测试。

- Reuse one Gate Check service at CLI, MCP, client-submission, and managed stage execution entry points.
- Require the context lock and four task artifacts for `ane-standard-page`, validating schemas, digests, source commit, and evidence-bundle membership.
- Generate and expose `stageTiming` from valid StageEvents, separating active execution time from waiting time.
- Provide one versioned stable-JSON and SHA-256 digest API for Gates, Providers, Context, and artifacts.
- Add tests for entry-point bypasses, missing locks, artifact tampering, timing projection, and digest stability.

## Capabilities / 能力

### New Capabilities / 新增能力

- `standard-page-contract-workflow`: StandardPage context locks, evidence-bound artifacts, schema validation, and stage timing output.

### Modified Capabilities / 修改能力

- `secure-loop-execution`: all protected execution and action entry points must share fail-closed Gate Check; timing and digest evidence become executable outputs.
- `portable-multi-agent-execution`: CLI, MCP, ACP, and client submission paths must preserve the same gate and artifact verification semantics.

## Impact / 影响范围

- Runtime: `execution-runtime`, `task-runtime`, `client-submission-runtime`, `provider-runtime`, `shared`.
- Contracts: shared types, Harness schema, StandardPage artifact schemas and tests.
- Workspace: StandardPage Harness/evaluator output contract and T-MAX project integration.
- No external T-MAX business repository or ignored mount state is changed.

- Runtime: `execution-runtime`, `task-runtime`, `client-submission-runtime`, `provider-runtime`, and `shared`.
- Contracts: shared types, the Harness schema, StandardPage artifact schemas, and tests.
- Workspace: StandardPage Harness/evaluator output contract and T-MAX project integration.
- No external T-MAX business repository or ignored mount state is changed.
