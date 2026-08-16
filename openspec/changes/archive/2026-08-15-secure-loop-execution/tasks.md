## 1. Canonical Gate Subjects / 规范门禁对象

- [x] 1.1 定义 canonical subject、GatePass v2 和组合 stage/action gate 输入类型；define canonical-subject, GatePass v2, and combined stage/action gate input types.
- [x] 1.2 实现字段投影、JCS v1 稳定序列化、SHA-256 和 gate policy digest；implement field projection, JCS v1 canonicalization, SHA-256, and gate-policy digests.
- [x] 1.3 让 HumanGate 在授权与检查时自行计算摘要，并使 legacy pass 只读不可执行；make HumanGate compute digests during grant/check and keep legacy passes audit-only.
- [x] 1.4 将 Gate CLI 从裸摘要迁移到审批对象文件，并补充兼容错误提示；migrate Gate CLI from raw digests to subject files with compatibility errors.
- [x] 1.5 增加键顺序、数组、Unicode、缺失字段、策略漂移和 legacy pass 测试；add tests for key order, arrays, Unicode, missing fields, policy drift, and legacy passes.

## 2. Stage Events And Timing / 节点事件与计时

- [x] 2.1 定义版本化 StageEvent、attempt、waiting reason 和投影结果类型；define versioned StageEvent, attempt, waiting-reason, and projection-result types.
- [x] 2.2 实现 append-only StageEventStore 与状态转换校验；implement the append-only StageEventStore and transition validation.
- [x] 2.3 实现按 run/task/stage/attempt 聚合的纯计时投影；implement pure timing projection scoped by run, task, stage, and attempt.
- [x] 2.4 增加正常、等待、失败、阻断、重试、倒序和未闭合事件测试；add tests for success, waiting, failure, blocking, retry, out-of-order, and unclosed events.

## 3. Secure Execution Runtime / 安全执行 Runtime

- [x] 3.1 新增 provider-neutral ExecutorAdapter 与统一 ExecutionRuntime；add a provider-neutral ExecutorAdapter and unified ExecutionRuntime.
- [x] 3.2 在 adapter 调用前强制 stage/action GateGuard，并在返回后强制 Harness；enforce stage/action GateGuard before adapter invocation and Harness after completion.
- [x] 3.3 在运行状态变化时追加 stage events，并对 blocked/failed 结果保留证据；append stage events on lifecycle changes and retain evidence for blocked/failed results.
- [x] 3.4 增加本机单执行实例锁，明确拒绝并发 writer；add a local single-executor lock and explicitly reject concurrent writers.
- [x] 3.5 更新 SimulationRuntime，使模拟覆盖新执行契约而不冒充真实计时；update SimulationRuntime to cover the new execution contract without pretending to provide real timing.

## 4. First Real Executor Adapter / 首个真实 Executor Adapter

- [x] 4.1 实现 Codex CLI read-only adapter，使用显式工作目录、sandbox、JSON schema 和 ephemeral 会话；implement the read-only Codex CLI adapter with explicit working directory, sandbox, JSON schema, and ephemeral sessions.
- [x] 4.2 对未配置 engine-owned action broker 的写节点返回 `unsupported_mutation_stage`；return `unsupported_mutation_stage` for mutation stages without an engine-owned action broker.
- [x] 4.3 增加假 executable 的端到端 adapter 测试，不调用网络或修改业务仓；add end-to-end adapter tests with a fake executable, without network calls or business-repository writes.
- [x] 4.4 增加 execute CLI 入口和结构化输出；add the execute CLI entry point and structured output.

## 5. Monitoring And Documentation / 监控与文档

- [x] 5.1 让监控读取 stage-events.jsonl 并按选定运行投影真实节点计时；make monitoring read stage-events.jsonl and project real timing for the selected run.
- [x] 5.2 对缺失、无效和部分事件保持 `unmeasured`/invalid，不使用模拟或文件时间估算；keep missing, invalid, and partial streams unmeasured/invalid without simulation or file-time estimates.
- [x] 5.3 更新中英双语 README 与监控说明，声明本地权威和只读 adapter 边界；update bilingual README and monitoring docs with local-authority and read-only-adapter boundaries.

## 6. Verification And Persistence / 验证与持久化

- [x] 6.1 运行聚焦单元测试、TypeScript no-emit、OpenSpec validation 和 git diff check；run focused unit tests, TypeScript no-emit, OpenSpec validation, and git diff check.
- [x] 6.2 经用户确认后运行 `npm run validate` 与 `npm test`；run `npm run validate` and `npm test` after user confirmation.
- [x] 6.3 检查 `git status --short -uall`，确认没有本机状态或外部仓内容；inspect `git status --short -uall` for local-state or external-repository leakage.
- [x] 6.4 写入双语 memory checkpoint 并执行 `memory:audit-today`；write a bilingual memory checkpoint and run `memory:audit-today`.
