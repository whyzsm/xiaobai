## Context

小白当前已经具备 Loop Engineering 的核心骨架：workflow、gate、Harness、evaluator、stage event、execution event、小能背景解析和 Codex CLI 只读执行器。`ExecutorAdapter` 已经是 provider-neutral 接口，适合扩展为多 provider runtime。

Xiaobai already has the core Loop Engineering scaffold: workflows, gates, Harness validation, evaluators, stage events, execution events, Xiaoneng background resolution, and a read-only Codex CLI executor. `ExecutorAdapter` is already provider-neutral and is a suitable base for a multi-provider runtime.

当前限制是执行能力仍停在“只读阶段”：CLI 在 `loop-engineering/cli/loop.ts` 中直接 new `CodexCliAdapter`；`CodexCliAdapter` 以 `codex-cli-read-only` 身份运行并拒绝非只读 stage；`WorktreeManager` 只生成路径和 branch 计划，不创建真实 Git worktree；execution lock 以 run 为粒度，阻止同一 run 内多个 task 真并发。

The current limitation is that execution remains read-only: the CLI directly creates `CodexCliAdapter` in `loop-engineering/cli/loop.ts`; `CodexCliAdapter` runs as `codex-cli-read-only` and rejects non-read-only stages; `WorktreeManager` only plans paths and branches without creating real Git worktrees; the execution lock is scoped to the run and prevents real concurrent tasks within one run.

目标不是做“Codex 版小白”“Claude 版小白”或“DeepSeek 版小白”。目标是让小白成为 AI 无关的工程运行系统，AI 产品只是入口或 provider。

The goal is not to create separate Codex, Claude, or DeepSeek variants of Xiaobai. The goal is to make Xiaobai an AI-independent engineering runtime, where AI products are only entry points or providers.

## Goals / Non-Goals

**Goals:**

- 小白提供统一任务协议，所有入口和 provider 共享同一套状态、门禁、lease、验证和交付语义。
- Xiaobai provides one task protocol, shared by all entry points and providers for state, gates, leases, verification, and delivery semantics.
- Codex、Claude、Gemini 可以作为 managed provider 被小白启动并在隔离 worktree 内执行。
- Codex, Claude, and Gemini can run as managed providers launched by Xiaobai inside isolated worktrees.
- DeepSeek Harness 可以通过 ACP stdio server 把小白当作 subagent provider 启动。
- DeepSeek Harness can launch Xiaobai as a subagent provider through an ACP stdio server.
- ZCode、WorkBuddy 和其他 AI 可以先通过 CLI/MCP client 模式接入，只有冒烟测试通过后才标记为 supported managed provider。
- ZCode, WorkBuddy, and other AI tools can initially integrate through CLI/MCP client mode and become supported managed providers only after smoke tests pass.
- 多个 AI 可以同时改同一个业务仓，但必须使用不同 worktree、不同 branch，并通过 merge queue 控制冲突。
- Multiple AI tools can modify the same business repository concurrently, but only through separate worktrees, separate branches, and a merge queue for conflict control.

**Non-Goals:**

- 不在本变更里实现任意 AI 的完整 UI 插件或专用 IDE 扩展。
- This change does not implement full UI plugins or dedicated IDE extensions for every AI.
- 不允许 provider 直接 push、merge、删 worktree 或改受保护 branch。
- Providers are not allowed to directly push, merge, delete worktrees, or modify protected branches.
- 不把外部业务仓源码、挂载目录或本机路径提交进小白工程仓。
- External business repository source, mount directories, and local machine paths must not be committed into the Xiaobai engineering repository.
- 不把 ZCode、WorkBuddy 等未验证工具直接宣称为完整 managed support。
- ZCode, WorkBuddy, and other unverified tools must not be claimed as fully managed support.

## Decisions

### Decision 1: Keep Xiaobai as the control plane / 决策 1：小白作为控制平面

小白持有 task runtime、project route、背景装配、门禁、worktree lease、provider registry、broker、verification 和 promotion。AI provider 只接收已装配任务并返回结构化结果。

Xiaobai owns the task runtime, project routing, background assembly, gates, worktree leases, provider registry, brokers, verification, and promotion. AI providers receive assembled tasks and return structured results.

选择原因：这样 Codex、Claude、Gemini、DeepSeek Harness、ZCode 和 WorkBuddy 不需要各自实现一套工程规则；安全边界、审计和验收条件只有一套。

Rationale: Codex, Claude, Gemini, DeepSeek Harness, ZCode, and WorkBuddy do not each need their own engineering rule system. Safety boundaries, audit, and acceptance criteria remain centralized.

替代方案是为每个 AI 做专属适配工程。该方案启动快，但规则分叉后难以保证一致门禁、背景真源和并发写入安全。

The alternative is to build a dedicated integration for each AI. That starts quickly, but diverging rules make consistent gates, context truth, and concurrent write safety difficult.

### Decision 2: Use four thin entry layers / 决策 2：使用四类薄入口

入口层只做协议转换，不持有业务语义：

Entry layers only translate protocols and do not own business semantics:

- CLI：本地和 CI 的基础入口，提供 `task create/claim/run/submit/status`。
- CLI: baseline local and CI entry, providing `task create/claim/run/submit/status`.
- MCP：Codex、Claude、Gemini、IDE agent 的工具入口。
- MCP: tool entry for Codex, Claude, Gemini, and IDE agents.
- ACP：DeepSeek Harness 的 stdio subagent provider 入口。
- ACP: stdio subagent provider entry for DeepSeek Harness.
- HTTP：远程或 Web AI 的后续入口，复用同一 task runtime。
- HTTP: later entry for remote or web AI tools, reusing the same task runtime.

选择原因：CLI 最稳，MCP 最适合 AI 工具，ACP 是 DeepSeek Harness 的自然对接点，HTTP 适合远程化。四者共享 runtime，避免四套逻辑。

Rationale: CLI is the most stable baseline, MCP fits AI tools, ACP is the natural DeepSeek Harness integration point, and HTTP supports remote usage. All four share the runtime to avoid four implementations.

### Decision 3: Provider runtime wraps `ExecutorAdapter` / 决策 3：Provider runtime 包装 `ExecutorAdapter`

保留现有 `ExecutorAdapter` 作为底层执行接口，并新增 provider registry、prompt runtime 和 provider adapter。Codex read-only adapter 不直接删除，而是升级为 registry 中的一个 profile；新增 Codex writable profile、Claude profile、Gemini profile 和 client-submission profile。

Keep the existing `ExecutorAdapter` as the low-level execution interface, and add a provider registry, prompt runtime, and provider adapters. The Codex read-only adapter is not removed; it becomes one registry profile. Add Codex writable, Claude, Gemini, and client-submission profiles.

选择原因：现有 execution runtime、Harness 和 event reporter 可以复用；新能力集中在 provider 选择、prompt 装配、sandbox/lease 参数和结果标准化。

Rationale: The existing execution runtime, Harness, and event reporter can be reused. New work is focused on provider selection, prompt assembly, sandbox and lease parameters, and result normalization.

### Decision 4: Worktree lease is the write boundary / 决策 4：Worktree lease 是写入边界

所有可写任务必须先拿到 `WorkspaceLease`。lease 包含 repository id、base ref、branch、worktree path、owner、heartbeat、status、dirty policy 和 evidence。provider 的 cwd 必须是 lease path 或 lease path 下的子目录。

Every writable task must acquire a `WorkspaceLease` first. The lease includes repository id, base ref, branch, worktree path, owner, heartbeat, status, dirty policy, and evidence. The provider cwd must be the lease path or a child of the lease path.

选择原因：多个 AI 同时改同一业务仓的唯一可控方式是 Git worktree + branch 隔离。共享一个工作目录会导致覆盖、锁争用和难以恢复。

Rationale: Git worktree plus branch isolation is the only controlled way for multiple AI tools to modify the same business repository concurrently. Sharing one working directory causes overwrites, lock contention, and poor recovery.

### Decision 5: Keep merge and destructive actions brokered / 决策 5：merge 和破坏性动作保持 broker 化

provider 可以在 lease 内修改文件，但 push、PR、merge、删除 worktree、删除 branch、修改受保护 branch 都必须走 broker。broker 检查 GatePass、lease 所属关系、diff、验证结果和 repository policy。

Providers may edit files inside the lease, but push, PR creation, merge, worktree deletion, branch deletion, and protected branch mutation must go through brokers. Brokers check GatePasses, lease ownership, diffs, verification results, and repository policy.

选择原因：AI 工具的 sandbox 能力不同，不能把安全边界建立在 provider 自律上。小白必须持有副作用授权。

Rationale: AI tools have different sandbox capabilities, so safety cannot rely on provider self-discipline. Xiaobai must own side-effect authorization.

### Decision 6: Client mode is accepted but not trusted / 决策 6：接受 client 模式但不信任它

client 模式用于外部 AI 自己运行、自己修改 worktree，然后把结果提交给小白。小白接受这种模式，但提交内容按不可信输入处理，必须重新跑 Harness、evaluator、diff 和策略检查。

Client mode is for external AI tools that run themselves, modify a worktree, and submit results back to Xiaobai. Xiaobai accepts this mode, but treats the submission as untrusted input and reruns Harness, evaluator, diff, and policy checks.

选择原因：这能快速接入 ZCode、WorkBuddy 或其他暂时不能由小白直接启动的 AI，同时不牺牲小白的验收边界。

Rationale: This quickly connects ZCode, WorkBuddy, or other AI tools that Xiaobai cannot yet launch directly, without weakening Xiaobai's acceptance boundary.

## Architecture

目标架构：

Target architecture:

```text
CLI / MCP / ACP / HTTP
        |
        v
TaskRuntime -> ProjectRoute -> Xiaoneng Context -> PromptRuntime
        |
        v
WorkspaceLease -> ProviderRuntime -> Codex / Claude / Gemini / Client AI
        |
        v
Harness -> Evaluator -> RepositoryActionBroker -> MergeQueue -> PR / Merge
```

核心数据合同：

Core data contracts:

- `TaskRequest`：入口提交的原始请求，包含项目、仓库、目标、动作、provider 偏好和 subject。
- `TaskRequest`: raw request submitted by entry points, including project, repository, target, actions, provider preference, and subject.
- `TaskEnvelope`：小白内部任务真源，包含状态、路由、门禁、prompt 摘要、lease、provider run 和事件。
- `TaskEnvelope`: internal Xiaobai source of truth for state, route, gates, prompt digest, lease, provider run, and events.
- `WorkspaceLease`：真实 Git worktree 的占用合同。
- `WorkspaceLease`: ownership contract for a real Git worktree.
- `ProviderProfile`：provider registry 条目。
- `ProviderProfile`: provider registry entry.
- `ProviderRunResult`：provider 输出、证据、工具事件、变更摘要和错误原因。
- `ProviderRunResult`: provider output, evidence, tool events, change summary, and failure reason.
- `PromotionPlan`：从 task branch 到 PR/merge 的受控交付计划。
- `PromotionPlan`: controlled delivery plan from task branch to PR or merge.

新增或扩展包：

New or expanded packages:

- `loop-engineering/packages/task-runtime`
- `loop-engineering/packages/provider-runtime`
- `loop-engineering/packages/prompt-runtime`
- `loop-engineering/packages/worktree-manager`
- `loop-engineering/packages/repository-action-broker`
- `loop-engineering/packages/merge-runtime`
- `loop-engineering/packages/mcp-server`
- `loop-engineering/packages/acp-server`
- `loop-engineering/cli`

## Migration Plan

### Phase 1: Contracts and no-op runtime / 阶段 1：合同与 no-op runtime

新增 shared 类型、task store、provider registry schema、prompt runtime 骨架和 CLI task 命令。此阶段不启动真实可写 provider，只证明任务状态和事件可记录。

Add shared types, task store, provider registry schema, prompt runtime scaffold, and CLI task commands. This phase does not launch real writable providers; it proves task state and events can be recorded.

验证方式：聚焦类型检查、task CLI 冒烟、OpenSpec validate。

Verification: focused type checks, task CLI smoke tests, and OpenSpec validation.

### Phase 2: Real worktree lease / 阶段 2：真实 worktree lease

把 `WorktreeManager` 从 plan-only 升级为 `prepare/claim/heartbeat/recover/release`，使用真实 `git worktree`，并记录 lease JSONL 事件。

Upgrade `WorktreeManager` from plan-only behavior to `prepare/claim/heartbeat/recover/release`, using real `git worktree` and recording lease JSONL events.

验证方式：临时 git fixture 中创建两个 task worktree、拒绝第二写入者、保留 dirty worktree、恢复 stale lease。

Verification: create two task worktrees in a temporary git fixture, reject a second writer, preserve dirty worktrees, and recover stale leases.

### Phase 3: Codex writable vertical slice / 阶段 3：Codex 可写纵切

新增 Codex writable profile，支持在 lease cwd 中运行并输出结构化结果。保留 read-only profile。push/PR/merge 仍由 broker 控制。

Add a Codex writable profile that runs inside the lease cwd and returns structured results. Keep the read-only profile. Push, PR, and merge remain broker-controlled.

验证方式：在 fixture 仓创建一个小修改，Harness 通过，diff 被记录，但未授权 push 被阻断。

Verification: create a small fixture repository change, pass Harness validation, record the diff, and block unauthorized push.

### Phase 4: Claude and Gemini providers / 阶段 4：Claude 与 Gemini providers

按 provider registry 增加 Claude 和 Gemini managed adapters。每个 adapter 只处理命令调用、prompt 包装、输出解析和事件标准化。

Add Claude and Gemini managed adapters through the provider registry. Each adapter handles only command invocation, prompt wrapping, output parsing, and event normalization.

验证方式：每个 provider 完成同一 fixture 写入任务，输出同一 `ProviderRunResult` 形态。

Verification: each provider completes the same fixture write task and returns the same `ProviderRunResult` shape.

### Phase 5: MCP and ACP / 阶段 5：MCP 与 ACP

新增 MCP server，把 task runtime 暴露为工具；新增 ACP stdio server，让 DeepSeek Harness 通过 ACP 启动小白并接收结构化进度。

Add an MCP server exposing the task runtime as tools. Add an ACP stdio server so DeepSeek Harness can launch Xiaobai through ACP and receive structured progress.

验证方式：MCP client 创建/查询任务；DeepSeek Harness 以 ACP provider 调用小白完成只读和可写 fixture 任务。

Verification: an MCP client creates and queries tasks; DeepSeek Harness invokes Xiaobai as an ACP provider for read-only and writable fixture tasks.

### Phase 6: Broker and merge queue / 阶段 6：Broker 与 merge queue

新增 repository action broker、PR broker 和 merge queue。实现冲突检测、验证汇总、promotion plan、受保护动作 gate 和人工授权。

Add repository action broker, PR broker, and merge queue. Implement conflict detection, verification aggregation, promotion plans, protected action gates, and human approval.

验证方式：两个 branch 改同一行时 promotion 阻断；授权 push/PR 成功；未授权 merge 关闭失败。

Verification: promotion blocks when two branches modify the same line; authorized push and PR creation succeed; unauthorized merge fails closed.

### Phase 7: Provider certification / 阶段 7：Provider 认证

为 Codex、Claude、Gemini、ZCode、WorkBuddy 分别跑 smoke test，并把 registry 支持等级更新为 `supported`、`experimental` 或 `client_only`。

Run smoke tests for Codex, Claude, Gemini, ZCode, and WorkBuddy, then update registry support levels to `supported`, `experimental`, or `client_only`.

验证方式：每个 provider 的 smoke 结果、sandbox profile、失败限制和支持等级都有证据。

Verification: each provider has evidence for smoke result, sandbox profile, failure limits, and support level.

## Risks / Trade-offs

- 风险：provider CLI 输出格式和 sandbox 能力随版本变化。缓解：registry 记录版本、profile、输出 schema 和 smoke evidence，未验证版本降级为 experimental。
- Risk: provider CLI output format and sandbox behavior may change by version. Mitigation: registry records versions, profiles, output schemas, and smoke evidence; unverified versions fall back to experimental.
- 风险：client 模式无法由小白完全控制 host sandbox。缓解：client submission 视为不可信输入，必须重新验证，不允许绕过 broker。
- Risk: client mode cannot be fully sandboxed by Xiaobai. Mitigation: client submissions are untrusted, must be reverified, and cannot bypass brokers.
- 风险：worktree lease 泄漏导致磁盘堆积。缓解：lease heartbeat、stale 标记、可审计 cleanup plan；dirty worktree 必须保留并等待人工确认。
- Risk: worktree lease leaks may accumulate on disk. Mitigation: lease heartbeat, stale marking, auditable cleanup plans; dirty worktrees are preserved for human confirmation.
- 风险：并发 branch 最终冲突。缓解：merge queue 在 promotion 阶段检测冲突并保留双方证据。
- Risk: concurrent branches may conflict eventually. Mitigation: merge queue detects conflicts at promotion and preserves evidence for both sides.
- 风险：一次性做完所有 provider 会拖慢落地。缓解：先完成 contracts、worktree lease、Codex writable，再接 Claude/Gemini，最后认证 ZCode/WorkBuddy。
- Risk: implementing all providers at once slows delivery. Mitigation: deliver contracts, worktree leases, and Codex writable first, then Claude/Gemini, then certify ZCode/WorkBuddy.

## Rollback Strategy

每个阶段必须保持向后兼容。read-only Codex adapter 保留为 fallback profile；新的 task runtime 和 provider runtime 在 feature flag 或显式 CLI 命令下启用。若新入口失败，可以回退到当前 `execute` 只读路径，不影响已有 gate、Harness 和 evaluator。

Each phase must remain backward compatible. The read-only Codex adapter remains as a fallback profile. The new task runtime and provider runtime are enabled behind feature flags or explicit CLI commands. If a new entry point fails, the system can fall back to the current read-only `execute` path without affecting existing gates, Harness validation, or evaluators.

worktree 和 broker 阶段回退时，必须保留所有 branch、worktree、lease event 和 dirty state，不自动删除任何业务仓内容。

When rolling back worktree or broker phases, all branches, worktrees, lease events, and dirty state must be preserved; no business repository content is deleted automatically.

## Open Questions

- DeepSeek Harness 当前 ACP provider 的精确命令参数和 result envelope 需要在实现 ACP server 前用官方仓或本地样例确认。
- The exact command arguments and result envelope for the current DeepSeek Harness ACP provider must be confirmed from the official repository or a local sample before implementing the ACP server.
- Claude、Gemini、ZCode、WorkBuddy 在本机的可执行命令、登录状态、非交互输出能力和 sandbox 选项需要逐个 smoke test。
- Claude, Gemini, ZCode, and WorkBuddy need individual smoke tests for local executable commands, login state, non-interactive output, and sandbox options.
- HTTP 入口是否首版实现取决于是否存在远程 AI 接入需求；无需求时先保留合同和接口边界。
- Whether HTTP ships in the first implementation depends on actual remote AI needs; without that need, keep only the contract and interface boundary.
