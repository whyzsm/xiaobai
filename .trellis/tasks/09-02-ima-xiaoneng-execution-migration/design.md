# 技术设计 / Technical Design

## 1. 边界 / Boundary

本次迁移只改小白工程仓的执行契约和配置，分为四层：IMA 只读上下文、T-MAX 项目路由、页面/API 执行模式、独立验证与观测。Xiaoneng 3.0 仅作为审计参照，不进入运行时依赖图。

This migration changes only Xiaobai's execution contracts and configuration. It has four layers: read-only IMA context, T-MAX project routing, page/API execution modes, and independent verification/observability. Xiaoneng 3.0 is audit reference only and is excluded from the runtime dependency graph.

## 2. 数据流 / Data Flow

```text
user requirement
  -> Xiaobai project/repository/branch resolution
  -> explicit imaQuery + tmax child scope
  -> read-only IMA adapter
  -> projectContext + retrieval evidence + contextDigest
  -> ane-standard-page or frontend-delivery route
  -> page contract / API contract / authorization lock
  -> generator writes only mounted target repository
  -> independent evaluator + human gate
  -> static/runtime evidence and stage timing
```

IMA documents are advisory business knowledge. Repository facts, API contracts, authorization, and runtime results remain separately sourced and separately evidenced.

## 3. 关键契约 / Key Contracts

### IMA context contract

- Input: `contextBindings[]` containing a read-only IMA binding plus `subject.imaQuery`.
- Scope: binding scope must equal the selected child Project scope; cross-scope documents fail closed.
- Evidence: query hash, selected IDs, retrieval time, source, revision, digest, scope, adapter version.
- Version policy: `pending-live-resolution` is not a blocking server lock; it remains an explicit unresolved state until IMA supplies a verifiable server revision/digest.
- Shared binding policy: one `scopeKind: shared` binding may live on the `t-max` ProjectGroup and is inherited by all eight children; `scopeKind: project` is reserved for a child-specific overlay.

### Page execution contract

- New page: `ane-standard-page` with `projectContext`, `evidenceSelection`, `page-contract.json`, `import-rule.json`, context/contract digests, human approval, and structure gate.
- Existing page: `KnownPageFollowup` or `QuickPatch` with current target page root, worktree baseline, authorization scope, changed files, and scoped static evidence.
- Structural changes cannot bypass design/structure gates.

### API execution contract

- `ApiWiring`: external contract lock, endpoint-by-endpoint code path and source hash evidence.
- `ApiIntegration`: all `ApiWiring` evidence plus runtime request/response evidence per endpoint.
- Status values: `contract_locked`, `code_wired`, `runtime_verified`, `runtime_blocked`.
- Runtime blockers are terminal for the run and must identify authentication, deployment, permission, or backend cause.

### Evaluation/timing contract

- Generator and evaluator must consume the same `contextDigest` and `contractDigest`.
- `allowSelfReview: false` remains mandatory.
- Each workflow stage records `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, `waitingMs`, `waitingReason`, `status`, and `evidence`; absent instrumentation is `unmeasured` with reason `missing_instrumentation`.

## 4. 兼容与回滚 / Compatibility and Rollback

- Keep legacy fixture/adaptation code only where tests prove parity; it must not be referenced by production T-MAX loop routing.
- Rollback is configuration-level: revert the Xiaobai migration commits and restore the prior project-context binding. Xiaoneng source remains untouched in either direction.
- If IMA retrieval is unavailable, permit only stages explicitly declared independent of business knowledge; block IMA-dependent implementation before write.
- Shared T-MAX knowledge is queried at the parent `t-max` scope; child-specific bindings remain opt-in and must not widen another child's scope.

## 5. 不在本轮实现 / Explicitly Deferred

- IMA server-side bundle revision/digest pinning.
- Automatic migration of every Xiaoneng agent/skill file into Xiaobai.
- Business repository page/API changes as migration proof; these will be later acceptance fixtures or user-authorized tasks.

## 6. 当前执行门禁 / Current Execution Gate

当前迁移契约和本地验证已经完成，但真实 DSH 执行仍为 No-Go：`loop-plan` 返回 `execution-bridge-unavailable`，真实 IMA MCP 返回的 media 元数据还没有归一化为小白要求的完整 document contract，因此不能生成可交给 DeepSeek Harness 的页面方案，也不能创建声称已执行的 client-submission 记录。

The migration contracts and local checks are complete, but real DSH execution is still No-Go: `loop-plan` returns `execution-bridge-unavailable`, and the real IMA MCP media metadata has not yet been normalized into Xiaobai's complete document contract. Therefore no page plan may be handed to DeepSeek Harness and no client-submission record may be represented as executed.

下一步必须由 DSH Host 提供并验证只读 IMA execution bridge，至少覆盖：逻辑 `t-max` scope 到真实 knowledge-base ID 的运行时映射、search/get 内容读取、frontmatter 中服务端 `revision`/`contentDigest` 的提取、字段脱敏归一化、`ImaTransport` 注入，以及 bridge 集成测试。桥接通过后，依次重跑 requirement intake、page contract/evaluator、human contract gate，再允许向 DeepSeek Harness 提交真实页面任务。

The next step is for the DSH Host to provide and verify a read-only IMA execution bridge covering at least: runtime mapping from logical `t-max` scope to the real knowledge-base ID, search/get content retrieval, extraction of server `revision`/`contentDigest` from frontmatter, redacted field normalization, `ImaTransport` injection, and bridge integration tests. Only after the bridge passes may requirement intake, page contract/evaluator, and the human contract gate be rerun before submitting a real page task to DeepSeek Harness.
