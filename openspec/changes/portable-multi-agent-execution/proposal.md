## Why

小白现在已经能把 T-MAX 项目、小能背景、workflow、gate、harness 和 evaluator 串成工程化骨架，但执行入口仍绑定 Codex CLI 的只读阶段，DeepSeek Harness、Claude、Gemini、ZCode、WorkBuddy 等 AI 还不能通过统一协议接入并安全修改业务仓。

Xiaobai can already connect the T-MAX project, Xiaoneng background context, workflows, gates, harnesses, and evaluators into an engineering scaffold, but the execution entry is still bound to read-only Codex CLI stages. DeepSeek Harness, Claude, Gemini, ZCode, WorkBuddy, and similar AI tools cannot yet join through one protocol and safely modify business repositories.

当前需要把小白明确升级为 AI 无关的 Loop Engineering 运行系统：AI 产品只作为入口或执行 provider，小白负责任务协议、背景装配、worktree 隔离、门禁、验证、交付和审计。

The system now needs to make Xiaobai an AI-independent Loop Engineering runtime: AI products act only as entry points or execution providers, while Xiaobai owns the task protocol, background assembly, worktree isolation, gates, verification, delivery, and audit.

## What Changes

- 新增统一任务协议，支持 CLI、MCP、ACP 和 HTTP 四类薄入口接入小白。
- Add a unified task protocol that supports CLI, MCP, ACP, and HTTP as thin Xiaobai entry points.
- 新增 provider runtime 与 provider registry，让 Codex、Claude、Gemini 和后续 AI 通过同一 `ExecutorAdapter` 合同执行。
- Add a provider runtime and provider registry so Codex, Claude, Gemini, and later AI tools execute through one `ExecutorAdapter` contract.
- 新增真实 Git worktree lease 生命周期，允许多个 AI 在同一业务仓的不同 worktree、不同 branch 上并发工作。
- Add a real Git worktree lease lifecycle so multiple AI tools can work concurrently on the same business repository through separate worktrees and branches.
- 新增受控写入与交付流程，所有 push、PR、merge、破坏性动作通过 broker、验证和人工门禁授权。
- Add controlled mutation and delivery flow where push, PR, merge, and destructive actions go through brokers, verification, and human gates.
- 新增 DeepSeek Harness ACP stdio server，让 harness 以 ACP subagent provider 方式启动小白。
- Add a DeepSeek Harness ACP stdio server so the harness can launch Xiaobai as an ACP subagent provider.
- 新增 MCP server 和公共 CLI 任务命令，让 Codex、Claude、Gemini、IDE agent、ZCode、WorkBuddy 可以按能力成熟度接入。
- Add an MCP server and public CLI task commands so Codex, Claude, Gemini, IDE agents, ZCode, and WorkBuddy can integrate according to their verified capability level.

## Capabilities

### New Capabilities

- `portable-multi-agent-execution`: 规定小白作为 AI 无关任务运行系统时的入口协议、provider 执行、worktree 并发隔离、受控交付、安全边界和验收行为。
- `portable-multi-agent-execution`: Defines Xiaobai's entry protocols, provider execution, concurrent worktree isolation, controlled delivery, safety boundaries, and acceptance behavior as an AI-independent task runtime.

### Modified Capabilities

- 无。本变更在 `secure-loop-execution` 已建立的关闭失败执行、门禁、Harness 和事件审计基础上新增能力，不放宽既有安全要求。
- None. This change adds capabilities on top of the fail-closed execution, gates, Harness validation, and event audit already established by `secure-loop-execution`; it does not weaken existing safety requirements.

## Impact

- 影响 `loop-engineering/packages/shared`：新增任务、provider、workspace lease、promotion 等公共类型。
- Affects `loop-engineering/packages/shared`: add shared types for tasks, providers, workspace leases, and promotion.
- 影响 `loop-engineering/packages/worktree-manager`：从只生成计划升级为真实 lease、heartbeat、恢复、释放和脏 worktree 保留。
- Affects `loop-engineering/packages/worktree-manager`: upgrade from plan-only behavior to real leases, heartbeats, recovery, release, and dirty worktree preservation.
- 影响 `loop-engineering/packages/execution-runtime`：从单 Codex 只读 adapter 扩展为 provider registry、可控写入 adapter、scoped lock 和事件追踪。
- Affects `loop-engineering/packages/execution-runtime`: expand from one read-only Codex adapter to a provider registry, controlled mutation adapters, scoped locks, and execution tracing.
- 影响 `loop-engineering/cli`：新增 `xiaobai task create/claim/run/submit/status` 或等价 loop CLI 命令，并去掉执行命令对 Codex adapter 的硬编码。
- Affects `loop-engineering/cli`: add `xiaobai task create/claim/run/submit/status` or equivalent loop CLI commands and remove the hard-coded Codex adapter from execution commands.
- 影响新增入口包：MCP server、ACP stdio server 和后续 HTTP API。
- Affects new entrypoint packages: MCP server, ACP stdio server, and later HTTP API.
- 影响交付链路：新增 repository action broker、merge queue、PR broker、独立 evaluator 复核和冲突阻断。
- Affects delivery: add a repository action broker, merge queue, PR broker, independent evaluator review, and conflict blocking.
