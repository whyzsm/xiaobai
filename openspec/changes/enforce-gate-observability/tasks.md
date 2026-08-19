## 1. Gate and Entry Points / 门禁与入口

- [x] 1.1 Add a shared GateCheck service for stage and protected-action subjects.
- [x] 1.2 Route CLI and MCP task run operations through the shared GateCheck service.
- [x] 1.3 Route client submission and other protected task operations through the shared GateCheck service.
- [x] 1.4 Add blocking tests proving no adapter, verification transition, or protected side effect occurs without a valid GatePass.

## 2. StandardPage Trust Boundary / 标准页可信边界

- [x] 2.1 Make the StandardPage context lock mandatory and validate task/project/background identity and selected bundles.
- [x] 2.2 Add schema loading and validation for page-contract, import-rule, evidence-selection, and context lock artifacts.
- [x] 2.3 Verify artifact digests, source commit, evidence-bundle membership, and realpath containment.
- [x] 2.4 Add missing, malformed, mismatched, and tampered artifact tests.

## 3. Timing and Digest / 计时与摘要

- [x] 3.1 Expose `stageTiming` from the execution runtime using valid StageEvents on every result path.
- [x] 3.2 Persist stage timing in task/report evidence and keep simulation-only stages explicitly unmeasured.
- [x] 3.3 Extract the shared canonical JSON and versioned SHA-256 digest utility.
- [x] 3.4 Migrate Gate, Provider, Context, and StandardPage artifact digest callers and add deterministic serialization tests.

## 4. Verification and Handoff / 验证与交付

- [x] 4.1 Run focused TypeScript build/tests and `git diff --check`.
- [x] 4.2 Ask for human confirmation before running `npm run validate` and `npm test`.
- [x] 4.3 Run an actual Xiaoneng-mounted StandardPage execution smoke test with a managed provider.
- [x] 4.4 Update the diff overlay and record remaining risks and evidence.

## Evidence And Remaining Risks / 证据与剩余风险

已完成的实现证据包括：`npm run build` 通过；临时副本中的完整 `npm test` 为 128/128 通过；临时副本中的 `npm run validate -- --workspace <temp-workspace>` 校验 3 个 Loop 均通过；真实 Xiaoneng 挂载的 managed Codex StandardPage smoke 通过，并写入 `StageTimingMetric` 与 `metrics.jsonl`；`openspec validate enforce-gate-observability --json` 返回 `valid: true` 且无 issues。

Completed implementation evidence: `npm run build` passed; the full `npm test` in a temporary copy passed 128/128; `npm run validate -- --workspace <temp-workspace>` in the temporary copy passed for all three Loops; the Xiaoneng-mounted managed Codex StandardPage smoke passed and wrote a `StageTimingMetric` to `metrics.jsonl`; `openspec validate enforce-gate-observability --json` returned `valid: true` with no issues.

当前工作区直接运行完整测试/校验仍受 ignored 的 `workspace/workspace.local.yaml` 影响：其 `memoryRoot` 指向本机不存在的 Obsidian 路径，因此本机 `validate` 场景无法读取 `state.md`。该本机配置未修改，也不应提交。另有 provider 的完整 evaluator、sandbox 认证与远端交付证据仍需人工门禁；本次未执行 commit 或 push。

The direct full test/validation path in this checkout is still affected by the ignored `workspace/workspace.local.yaml`: its `memoryRoot` points to a missing local Obsidian path, so the local validation scenario cannot read `state.md`. That machine-local file was not changed and must not be committed. Full provider evaluator, sandbox certification, and remote-delivery evidence still require a human gate; this change has not been committed or pushed.
