## 1. Contracts / 合同

- [x] 1.1 Add shared `TaskRequest`, `TaskEnvelope`, task state, task event, provider mode, and entry point types. / 新增共享 `TaskRequest`、`TaskEnvelope`、任务状态、任务事件、provider 模式和入口类型。
- [x] 1.2 Add shared `WorkspaceLease`, lease state, lease owner, heartbeat, dirty policy, and lease evidence types. / 新增共享 `WorkspaceLease`、lease 状态、lease owner、心跳、脏状态策略和 lease 证据类型。
- [x] 1.3 Add shared `ProviderProfile`, `ProviderRunRequest`, `ProviderRunResult`, provider support level, and capability mismatch types. / 新增共享 `ProviderProfile`、`ProviderRunRequest`、`ProviderRunResult`、provider 支持等级和能力不匹配类型。
- [x] 1.4 Add shared `PromotionPlan`, broker decision, merge queue state, and repository action evidence types. / 新增共享 `PromotionPlan`、broker 决策、merge queue 状态和仓库动作证据类型。
- [x] 1.5 Add schema or validator coverage for new task, provider, lease, and promotion contracts. / 为新增 task、provider、lease 和 promotion 合同补充 schema 或 validator 覆盖。

## 2. Task Runtime / 任务 Runtime

- [x] 2.1 Create `task-runtime` package with task creation, loading, status transition, append-only event recording, and recovery projection. / 创建 `task-runtime` 包，支持任务创建、加载、状态流转、追加式事件记录和恢复投影。
- [x] 2.2 Route task creation through existing project route resolution and repository target selection. / 让任务创建复用现有项目路由解析和目标仓库选择。
- [x] 2.3 Integrate Xiaoneng background resolution into task preparation and store context digest on the task envelope. / 在任务准备阶段接入小能背景解析，并把上下文摘要写入 task envelope。
- [x] 2.4 Add task commands for create, claim, run, submit, status, and cancel through the existing CLI surface. / 在现有 CLI 层新增 create、claim、run、submit、status 和 cancel 任务命令。
- [x] 2.5 Add focused task runtime tests for state transitions, invalid transitions, recovery from events, and unsupported operations. / 为任务状态流转、非法流转、事件恢复和不支持操作补充聚焦测试。

## 3. Prompt And Provider Runtime / 提示词与 Provider Runtime

- [x] 3.1 Create `prompt-runtime` package that assembles task subject, workflow stage, gate constraints, Harness output schema, and Xiaoneng context into one provider-neutral prompt payload. / 创建 `prompt-runtime` 包，把任务对象、workflow 节点、门禁约束、Harness 输出 schema 和小能上下文装配成 provider-neutral prompt payload。
- [x] 3.2 Create `provider-runtime` package with provider registry loading, capability checks, profile selection, timeout policy, and adapter dispatch. / 创建 `provider-runtime` 包，支持 provider registry 加载、能力检查、profile 选择、超时策略和 adapter 派发。
- [x] 3.3 Refactor CLI execution so it selects adapters through provider runtime instead of directly constructing `CodexCliAdapter`. / 重构 CLI 执行路径，让它通过 provider runtime 选择 adapter，而不是直接构造 `CodexCliAdapter`。
- [x] 3.4 Preserve the existing Codex read-only adapter as a registry profile and add compatibility tests for current read-only behavior. / 把现有 Codex 只读 adapter 保留为 registry profile，并为当前只读行为补兼容测试。
- [x] 3.5 Add provider event normalization for prompt assembled, model requested, model completed, tool call, tool result, and failure events. / 新增 provider 事件标准化，覆盖 prompt assembled、model requested、model completed、tool call、tool result 和 failure。

## 4. Worktree Lease Runtime / Worktree Lease Runtime

- [x] 4.1 Upgrade `WorktreeManager` from plan-only output to prepare, claim, heartbeat, recover, and release operations backed by real `git worktree` commands. / 将 `WorktreeManager` 从只输出计划升级为基于真实 `git worktree` 命令的 prepare、claim、heartbeat、recover 和 release 操作。
- [x] 4.2 Add deterministic lease paths and unique task branches while keeping local mount paths and external repository contents out of the Xiaobai repo diff. / 新增确定性 lease 路径和唯一 task branch，同时避免把本机挂载路径和外部仓内容写入小白工程仓 diff。
- [x] 4.3 Enforce one writer per lease and allow read-only reviewers without writer ownership. / 强制每个 lease 只有一个写入者，并允许没有写入 ownership 的只读 reviewer。
- [x] 4.4 Add stale lease recovery and dirty worktree retention that never deletes changed worktrees automatically. / 新增 stale lease 恢复和脏 worktree 保留，禁止自动删除有变更的 worktree。
- [x] 4.5 Add git fixture tests for two concurrent leases, occupied lease rejection, heartbeat expiry, clean release, and dirty retention. / 使用 git fixture 测试两个并发 lease、占用 lease 拒绝、心跳过期、干净释放和脏状态保留。

## 5. Writable Provider Slice / 可写 Provider 纵切

- [x] 5.1 Add Codex writable provider profile that runs only inside a claimed workspace lease with explicit cwd and configured sandbox. / 新增 Codex 可写 provider profile，只允许它在已领取 workspace lease 内以显式 cwd 和配置 sandbox 运行。
- [x] 5.2 Extend provider result parsing to include changed files, diff summary, evidence, verification commands, and structured failure reasons. / 扩展 provider 结果解析，包含变更文件、diff 摘要、证据、验证命令和结构化失败原因。
- [x] 5.3 Block writable execution when no lease exists, the lease is stale, the cwd is outside the lease root, or provider capability is read-only. / 在无 lease、lease 陈旧、cwd 位于 lease root 外或 provider 能力只读时阻断可写执行。
- [ ] 5.4 Add a fixture task proving Codex can make a small leased worktree edit without push or merge authority. / 增加 fixture 任务，证明 Codex 能在 leased worktree 内完成小修改且没有 push 或 merge 权限。

## 6. Repository Broker And Merge Queue / 仓库 Broker 与 Merge Queue

- [x] 6.1 Create repository action broker for push, PR creation, protected branch updates, branch deletion, worktree cleanup, and destructive actions. / 创建 repository action broker，覆盖 push、PR 创建、受保护 branch 更新、branch 删除、worktree 清理和破坏性动作。
- [x] 6.2 Require GatePass and lease ownership validation before every brokered repository side effect. / 每个 broker 化仓库副作用执行前必须校验 GatePass 和 lease ownership。
- [x] 6.3 Create merge queue runtime that builds promotion plans from verified task branches. / 创建 merge queue runtime，根据已验证任务 branch 构建 promotion plan。
- [x] 6.4 Detect same-file and same-line conflicts before promotion and preserve both task branches when conflicts block merge. / 在 promotion 前检测同文件和同行冲突，冲突阻断 merge 时保留两个任务 branch。
- [x] 6.5 Add broker and merge queue tests for unauthorized push, authorized push, unauthorized merge, conflict blocking, and dirty cleanup refusal. / 为未授权 push、已授权 push、未授权 merge、冲突阻断和脏清理拒绝补充 broker 与 merge queue 测试。

## 7. MCP ACP And External Clients / MCP、ACP 与外部 Client

- [x] 7.1 Create MCP server tools for task create, claim, run, submit, status, and list provider profiles. / 创建 MCP server tools，支持 task create、claim、run、submit、status 和 provider profile 列表。
- [x] 7.2 Create ACP stdio server that maps DeepSeek Harness messages to task runtime operations and streams structured progress. / 创建 ACP stdio server，把 DeepSeek Harness 消息映射到 task runtime 操作，并流式输出结构化进度。
- [x] 7.3 Add client mode submission flow that treats external AI output as untrusted and reruns Harness, evaluator, diff, and policy checks. / 新增 client 模式提交流程，把外部 AI 输出视为不可信，并重新执行 Harness、evaluator、diff 和策略检查。
- [x] 7.4 Add smoke tests for CLI and MCP equivalence on task creation and status projection. / 补充 CLI 与 MCP 在任务创建和状态投影上的等价性冒烟测试。
- [x] 7.5 Add DeepSeek Harness ACP smoke test against a local fixture before marking ACP integration supported. / 在标记 ACP 集成为 supported 前，增加 DeepSeek Harness ACP 对本地 fixture 的冒烟测试。

## 8. Provider Certification / Provider 认证

- [x] 8.1 Add provider registry entries for Codex read-only, Codex writable, Claude managed, Gemini managed, and client-submission. / 新增 Codex 只读、Codex 可写、Claude managed、Gemini managed 和 client-submission 的 provider registry 条目。
- [ ] 8.2 Run and record writable smoke tests for Codex, Claude, and Gemini before marking each verified profile as supported. / 对 Codex、Claude 和 Gemini 运行并记录可写冒烟测试，再把已验证 profile 标记为 supported。
- [x] 8.3 Keep ZCode and WorkBuddy as experimental or client-only until local smoke tests prove managed execution, output parsing, and sandbox boundaries. / 在本机冒烟测试证明 managed 执行、输出解析和 sandbox 边界前，将 ZCode 和 WorkBuddy 保持为 experimental 或 client-only。
- [x] 8.4 Document provider support levels, known sandbox assumptions, required local commands, and failure modes in bilingual Markdown. / 用中英双语 Markdown 记录 provider 支持等级、已知 sandbox 假设、必需本机命令和失败模式。

## 9. Verification And Release Gates / 验证与发布门禁

- [x] 9.1 Validate this OpenSpec change with `openspec validate portable-multi-agent-execution --json`. / 使用 `openspec validate portable-multi-agent-execution --json` 校验本 OpenSpec 变更。
- [x] 9.2 Before implementation merge, ask for explicit approval before running repository-wide `npm run validate` or `npm test`. / 实现合并前，运行仓库级 `npm run validate` 或 `npm test` 前必须先请求明确批准。
- [x] 9.3 Verify `git status --short -uall` does not include external repositories, local mounts, `.local`, or machine-specific path files. / 校验 `git status --short -uall` 不包含外部仓库、本机挂载、`.local` 或机器专属路径文件。
- [ ] 9.4 Archive the change only after implementation tasks, smoke tests, security gates, and provider certification evidence are complete. / 只有实现任务、冒烟测试、安全门禁和 provider 认证证据全部完成后才归档本变更。
