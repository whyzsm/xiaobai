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
