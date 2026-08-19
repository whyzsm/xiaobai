## Context / 背景

当前 `ExecutionRuntime` 已有 GateGuard 和 StageEvent，但 task lifecycle、client submission 和 MCP/CLI task entry 没有共享 Gate Check。StandardPage artifact reader 只做 JSON parse 和原始文本摘要，context lock 可缺失，执行结果也没有 `stageTiming` 字段。Gate 使用 `jcs-v1`，Provider 和 artifact 又有独立 SHA-256 实现。

The current `ExecutionRuntime` has a GateGuard and StageEvents, but task lifecycle, client submission, and MCP/CLI task entries do not share the Gate Check. The StandardPage artifact reader only parses JSON and hashes raw text, context locks may be absent, and execution results do not expose `stageTiming`. Gates use `jcs-v1`, while Providers and artifacts have separate SHA-256 implementations.

## Goals / Non-Goals

**Goals / 目标：**

- One fail-closed Gate Check service for all protected entry points.
- Required StandardPage lock and artifact validation with evidence binding.
- Stage timing projection in execution results and delivery evidence.
- One versioned canonical JSON digest utility.

- 为所有受保护入口提供统一关闭失败 Gate Check。
- 强制标准页上下文锁和证据绑定产物校验。
- 在执行结果和交付证据中暴露节点计时投影。
- 提供版本化稳定 JSON 摘要工具。

**Non-Goals / 非目标：**

- Do not change T-MAX business repositories or mount lifecycle.
- Do not promote experimental providers without real smoke evidence.
- Do not estimate timing for simulation-only stages.

- 不修改 T-MAX 业务仓或挂载生命周期。
- 没有真实冒烟证据时不提升 experimental provider 等级。
- 不为仅模拟阶段估算耗时。

## Decisions / 决策

1. **Shared GateCheck service / 共享 GateCheck 服务**：把 subject projection 和 `HumanGate.check` 封装为独立 runtime 服务；入口只负责传递 task/stage/action 上下文。这样 CLI、MCP、client submission 和 managed execution 不会复制门禁语义。

   **Shared GateCheck service / Shared GateCheck service**: encapsulate subject projection and `HumanGate.check` in one runtime service; entry points only supply task/stage/action context. This prevents CLI, MCP, client submission, and managed execution from duplicating gate semantics.

2. **Strict StandardPage validation / 严格标准页校验**：只对 `ane-standard-page` 启用必需 lock/artifact 清单；使用已有 AJV/YAML 工具加载 Xiaoneng contract schema，并用 canonical digest 校验绑定关系。普通 Loop 保留兼容路径。

   **Strict StandardPage validation / Strict StandardPage validation**: require the lock/artifact manifest only for `ane-standard-page`; use existing AJV/YAML utilities for Xiaoneng contract schemas and the canonical digest for bindings. Keep compatibility for ordinary Loops.

3. **Timing projection at execution boundary / 在执行边界投影计时**：复用 `projectStageTiming`，在所有返回路径统一生成 projection；事件不存在或无效时返回 `unmeasured`，不改写历史事件。

   **Timing projection at execution boundary / Timing projection at execution boundary**: reuse `projectStageTiming` and generate the projection on every return path; return `unmeasured` for absent or invalid events without rewriting historical events.

4. **Canonical digest utility / 规范摘要工具**：从 `subjectDigest.ts` 提取公共稳定序列化和版本化 SHA-256 函数；保留 GatePass 的 `sha256:` 表示，同时让其他调用方通过同一 API 明确选择带前缀或原始 hex 的外部表示，避免自行 `JSON.stringify`。

   **Canonical digest utility / Canonical digest utility**: extract shared stable serialization and versioned SHA-256 functions from `subjectDigest.ts`; retain the GatePass `sha256:` representation while making other callers explicitly choose prefixed or raw-hex external forms through the same API instead of calling `JSON.stringify` themselves.

## Risks / Trade-offs

- [Compatibility] Existing stored events may lack new timing/digest fields -> keep readers backward compatible and mark unavailable measurements as `unmeasured`.
- [入口覆盖] A new entry point could bypass the service -> add a single service call in each public operation and integration tests for CLI/MCP/client paths.
- [Artifact trust] A valid JSON file may still be semantically wrong -> require schema, digest, source commit, and evidence-bundle checks before adapter invocation.

- [兼容性] 既有事件可能缺少新的计时/摘要字段 -> 读取端保持兼容，不可用计时标为 `unmeasured`。
- [Entry coverage] A new entry point could bypass the service -> add one service call per public operation and integration tests for CLI/MCP/client paths.
- [产物可信] 合法 JSON 仍可能语义错误 -> 在调用 adapter 前强制 schema、摘要、来源 commit 和证据包校验。

## Migration Plan / 迁移计划

1. Add the shared digest and gate services while preserving current public types.
2. Add strict StandardPage checks and tests; old non-StandardPage flows remain unchanged.
3. Add `stageTiming` to execution output and reports.
4. Run focused tests, then obtain human confirmation before `npm run validate` and `npm test`.
5. Roll back by reverting the change and retaining append-only event/artifact files for audit.

1. 增加共享摘要和门禁服务，同时保留当前公共类型。
2. 增加严格标准页校验和测试；旧的非标准页流程保持不变。
3. 在执行输出和报告中增加 `stageTiming`。
4. 先运行聚焦测试，再获得人工确认后运行 `npm run validate` 和 `npm test`。
5. 回滚时回退本次代码变更，追加式事件/产物文件仍保留用于审计。

## Open Questions / 未决问题

- Whether external consumers require the `sha256:` prefix or raw hex for non-Gate evidence. The implementation will keep both explicit representations behind one utility until the contract is confirmed.
- 外部消费者对非 Gate evidence 是否要求 `sha256:` 前缀或原始 hex 尚未确认。在契约确认前，实现会通过同一工具明确保留两种外部表示。
