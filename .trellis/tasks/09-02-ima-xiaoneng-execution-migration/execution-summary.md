# IMA 与 DeepSeek Harness 执行监督摘要 / IMA And DeepSeek Harness Execution Supervision Summary

本轮确认没有把真实页面任务提交给 DeepSeek Harness。DSH 进程虽在运行，但未发现本次迁移对应的 ACP、client-submission、TaskEnvelope 或 task/submitted 证据。

This round confirmed that no real page task was submitted to DeepSeek Harness. Although the DSH process is running, no ACP, client-submission, TaskEnvelope, or task/submitted evidence was found for this migration.

共享 IMA 绑定已由 `t-max` ProjectGroup 继承到 8 个 T-MAX child Project，统一使用 `know_tmax_shared_ima`、`scope=t-max`、`scopeKind=shared`、`readOnly=true`。执行时只有 subject 提供显式 `imaQuery` 才调用 IMA；无 query 的 legacy fixture 不访问 transport，显式 query 仍保持 scope、revision、digest、evidence 校验和 fail-closed。

The shared IMA binding is inherited from the `t-max` ProjectGroup by all eight T-MAX child Projects with `know_tmax_shared_ima`, `scope=t-max`, `scopeKind=shared`, and `readOnly=true`. IMA is called only when the subject provides an explicit `imaQuery`; legacy fixtures without a query do not access the transport, while explicit queries retain scope, revision, digest, evidence validation, and fail-closed behavior.

本地构建和聚焦测试通过：`npm run build --silent`；runtime 与 IMA 测试 74/74；portable contract、provider、project-context 测试 36/36；Trellis task validation 和 `git diff --check` 通过。真实 IMA MCP 返回的 media 元数据尚未归一化为完整 document contract，`loop-plan` 仍报告 `execution-bridge-unavailable`，因此当前 DSH 交接结论为 No-Go。

Local build and focused tests passed: `npm run build --silent`; runtime and IMA tests 74/74; portable contract, provider, and project-context tests 36/36; Trellis task validation and `git diff --check` passed. The real IMA MCP media metadata has not yet been normalized into the complete document contract, and `loop-plan` still reports `execution-bridge-unavailable`, so the current DSH handoff decision is No-Go.

下一步必须由 DSH Host 提供只读 IMA execution bridge，负责 `t-max` scope 到真实 knowledge-base ID 的映射、search/get 内容读取、frontmatter 中服务端 revision/contentDigest 提取、字段脱敏归一化和 `ImaTransport` 注入；完成集成测试后，才能重跑 intake、页面契约、独立 evaluator、human gate，再提交真实页面任务。

The next step is for the DSH Host to provide a read-only IMA execution bridge for mapping `t-max` scope to the real knowledge-base ID, retrieving search/get content, extracting server revision/contentDigest from frontmatter, redacting and normalizing fields, and injecting `ImaTransport`. Only after bridge integration tests pass may intake, page contract, independent evaluator, and human gate be rerun before submitting a real page task.

外部 xiaoneng3.0 与 T-MAX dcm 源码未被本轮修改；dcm 中既有 staged `D .claude/skills` 保留；未提交或 push。

The external xiaoneng3.0 and T-MAX dcm source were not modified in this round; the pre-existing staged `D .claude/skills` in dcm was preserved; no commit or push was performed.

# 2026-09-03 更新：执行桥交付与 No-Go 解除 / 2026-09-03 Update: Bridge Delivered And No-Go Lifted

上文 No-Go 结论所依赖的前提已全部消除。DSH Host 侧只读 IMA 执行桥（`@xiaobai/dsh-plugin`，监听 `127.0.0.1:8791`）已交付：scope-map 将 `t-max` 映射到真实知识库、search/get 内容读取、frontmatter 服务端 revision/contentDigest 提取、字段脱敏归一化、`ImaTransport` 经 `XIAOBAI_IMA_BRIDGE_URL` 注入，集成测试全绿；独立监督审计 M1-M4 全部 PASS。

The premises behind the No-Go conclusion above have all been removed. The read-only IMA execution bridge on the DSH Host side (`@xiaobai/dsh-plugin`, listening on `127.0.0.1:8791`) has been delivered: scope-map maps `t-max` to the real knowledge base, search/get content is readable, server revision/contentDigest is extracted from frontmatter, fields are redacted and normalized, `ImaTransport` is injected via `XIAOBAI_IMA_BRIDGE_URL`, and integration tests are green; the independent supervision audit passed M1-M4.

`loop-plan` 现为桥感知：`planCoreLoop` 接受 `input.executionBridge`，健康桥下 `ane-standard-page` 报告 `bridge-ready` 且无执行阻断项；桥不可用时保留 `execution-bridge-unavailable`（fail-closed）。CLI 经 `probeImaBridgeHealth()` 以同一环境变量门控探测 `/health`。

`loop-plan` is now bridge-aware: `planCoreLoop` accepts `input.executionBridge`; with a healthy bridge, `ane-standard-page` reports `bridge-ready` with no execution blockers, while an unavailable bridge keeps `execution-bridge-unavailable` (fail-closed). The CLI probes `/health` through `probeImaBridgeHealth()` gated by the same environment variable.

真实页面任务（第 7 项）已按本文“下一步”要求完整执行：需求 intake（语雀《操作货量预测》+ 2 张原型图）→ 目标仓解析（dcm@master `65a7c3d9ab`）→ 项目上下文锁定 → 真实 IMA 检索（query=页面验收，2 份清单，revision `2a28700b…`）→ 页面契约生成与预检（schema + `sha256:ac4f6725…` 摘要锁）→ 独立 evaluator（fork 子代理 6/6 approve）→ human gate 停在 `awaiting-user-decision`。运行 `run-dcm-forecast-20260903021132`，前 6 阶段 passed、第 7 阶段按设计 blocked 等待用户；监督审计 M5 PASS。

The real page task (item 7) has been executed end-to-end as this document's "next step" required: requirement intake (Yuque "操作货量预测" plus two prototype images), target repository resolution (dcm@master `65a7c3d9ab`), project-context lock, real IMA retrieval (query=页面验收, two checklists, revision `2a28700b…`), page contract generation and preflight (schema plus `sha256:ac4f6725…` digest lock), an independent evaluator (forked subagent, 6/6 approve), and the human gate stopped at `awaiting-user-decision`. Run `run-dcm-forecast-20260903021132` passed the first six stages, and the seventh is blocked by design awaiting the user; supervision audit M5 passed.

第 8 项（client-submission 把编码任务交给 DeepSeek Harness）在用户明确批准 human gate 之前不启动；外部仓仍零实质变更，未提交、未 push。

Item 8 (client-submission handing the coding task to DeepSeek Harness) will not start until the user explicitly approves the human gate; external repositories remain substantively unchanged, with no commit and no push.
