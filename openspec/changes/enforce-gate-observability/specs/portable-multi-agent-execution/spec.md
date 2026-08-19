## MODIFIED Requirements

修改要求 / Chinese modification requirements

### Requirement: Entry points share one task runtime / 入口共享同一个任务 runtime
CLI, MCP, ACP, HTTP, and client-submission entry points SHALL delegate task lifecycle operations and protected-operation checks to shared runtime services. Equivalent operations SHALL use the same Gate Check, StandardPage artifact verification, evidence, and timing semantics.

CLI、MCP、ACP、HTTP 和 client-submission 入口必须把任务生命周期操作和受保护操作检查委托给共享 runtime 服务。等价操作必须使用相同的 Gate Check、标准页产物校验、证据和计时语义。

#### Scenario: Entry point cannot skip artifact verification / 入口不能跳过产物校验
- **WHEN** a StandardPage task is submitted through CLI, MCP, ACP, or client mode
- **THEN** the shared runtime validates the context lock and required artifacts before accepting the submission
- **当** 标准页任务通过 CLI、MCP、ACP 或 client 模式提交
- **则** 共享 runtime 在接受提交前校验上下文锁和必需产物

#### Scenario: Equivalent entry points expose equivalent timing / 等价入口暴露等价计时
- **WHEN** equivalent executions are replayed through two supported entry points
- **THEN** both expose the same stage timing field contract and waiting-reason vocabulary
- **当** 等价执行通过两个支持的入口重放
- **则** 两者暴露相同的节点计时字段契约和等待原因词汇
