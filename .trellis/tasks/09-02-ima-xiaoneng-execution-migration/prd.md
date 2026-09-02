# IMA 知识层与小能执行能力迁移到小白 / Migrate IMA Knowledge and Xiaoneng Execution Capabilities to Xiaobai

## Goal / 目标

让小白成为 T-MAX 前端任务的生产执行入口：通过只读 IMA 获取业务知识，并在小白自己的 Loop、Harness、Generator、Evaluator 和 Human Gate 中完成新页面、已有页面修改、API 接线与真实联调。保留 `/Users/seminzhu/Documents/AI/xiaoneng` 及其 `xiaoneng3.0` 源码不变，迁移只发生在本工程。

Make Xiaobai the production execution entry for T-MAX frontend work: retrieve business knowledge from read-only IMA, then complete new pages, existing-page changes, API wiring, and runtime integration through Xiaobai-owned loops, harnesses, generators, evaluators, and human gates. Preserve `/Users/seminzhu/Documents/AI/xiaoneng` and its `xiaoneng3.0` source unchanged; migration changes are limited to this repository.

## Requirements / 需求

1. 小白必须在 T-MAX 项目上下文中显式使用 `imaQuery`，按 child Project scope 检索 IMA；检索结果必须携带 query、selected item IDs、retrievedAt、source、revision、digest、scope，并写入运行证据。缺少 connector、transport、scope 或结果时必须 fail-closed。

   Xiaobai must use an explicit `imaQuery` within T-MAX project context and retrieve IMA data by child-Project scope. Retrieval must record the query, selected item IDs, retrievedAt, source, revision, digest, and scope in execution evidence. Missing connector, transport, scope, or results must fail closed.

   T-MAX 共享背景例外：原 Xiaoneng 背景与技能由 8 个 child Project 共用；IMA 可由 `t-max` ProjectGroup 声明 `scopeKind: shared` 的只读 binding，所有 child 自动继承。child scope 仅用于项目专属 overlay，不得把共享 binding 复制成 8 份。

   Shared T-MAX context exception: the legacy Xiaoneng background and skills were shared by eight child Projects. IMA may declare one read-only `scopeKind: shared` binding on the `t-max` ProjectGroup, inherited by every child. A child scope is reserved for project-specific overlays; the shared binding must not be copied eight times.

2. IMA 只提供知识上下文，不能成为实时仓库事实、鉴权来源、API 运行结果或发布凭据；小白必须继续解析目标仓、分支、worktree、授权范围和实时接口契约。

   IMA supplies knowledge context only. It must not be treated as live repository facts, authentication, API runtime results, or release authority. Xiaobai must still resolve the target repository, branch, worktree, authorization scope, and live API contract.

3. 新页面必须经 `ane-standard-page` Loop，完成项目上下文锁定、证据选择、页面契约、导入规则、结构门禁、独立 evaluator 和人工设计/契约 gate 后才允许写入。

   New pages must use the `ane-standard-page` Loop and complete project-context locking, evidence selection, page contract, import rules, structure gates, independent evaluator review, and human design/contract approval before writing.

4. 已有页面修改必须保留 `KnownPageFollowup` / `QuickPatch` 的最小范围、基线和授权约束；不能因检索到知识而扩大修改范围。

   Existing-page changes must preserve the minimal scope, baseline, and authorization constraints of `KnownPageFollowup` / `QuickPatch`; retrieved knowledge must never widen the change scope.

5. API 任务必须区分 `ApiWiring` 与 `ApiIntegration`：前者锁定外部契约并证明代码接线，后者额外要求逐 endpoint 的运行态证据；鉴权、部署或后端不可用时标记 `runtime_blocked`。

   API work must distinguish `ApiWiring` from `ApiIntegration`: the former locks the external contract and proves code wiring, while the latter additionally requires per-endpoint runtime evidence. Missing authentication, deployment, or backend availability must result in `runtime_blocked`.

6. Xiaobai loop 的完成判定必须由独立 evaluator 和 human gate 共同完成，不得使用 generator 自评代替；workflow stage timing 必须记录，未采集时显式标记 `unmeasured`。

   Xiaobai completion must be decided by an independent evaluator and human gates; generator self-review cannot substitute for them. Workflow stage timing must be recorded, and missing timing must be explicitly marked `unmeasured`.

## Constraints / 约束

- 不修改、删除、移动或提交 Xiaoneng 源码；不把 Xiaoneng mount 作为小白生产运行时依赖。
- 不向 IMA 写入、删除或覆盖文档；本任务只消费已经整理的知识库。
- 不修改 T-MAX 业务仓源码；只修改本工程中的 runtime、workspace、schema、测试和文档。
- 不执行业务仓启动、构建、提交或推送；工程仓的 `npm run validate` 与 `npm test` 需在提交前由用户确认后执行。

- Do not modify, delete, move, or commit Xiaoneng source; Xiaoneng mounts must not become Xiaobai production runtime dependencies.
- Do not write, delete, or overwrite IMA notes; this task only consumes the curated knowledge base.
- Do not modify T-MAX business repository source; changes are limited to runtime, workspace, schemas, tests, and documentation in this repository.
- Do not start/build/commit/push business repositories; before commit, `npm run validate` and `npm test` require explicit user confirmation.

## Acceptance Criteria / 验收标准

- [ ] IMA retrieval is explicit, project-scoped, read-only, evidence-backed, and fail-closed; no credential or Xiaoneng source path is persisted.
- [ ] `ane-standard-page` can consume project-context and IMA evidence without any Xiaoneng runtime or background requirement.
- [ ] Existing-page follow-up and API modes have executable contracts for authorization, baseline, impact, and evidence status.
- [ ] API integration distinguishes `contract_locked`, `code_wired`, `runtime_verified`, and `runtime_blocked` per endpoint.
- [ ] Independent evaluator and human-gate checks remain active; generator self-review cannot complete a loop.
- [ ] Stage timing fields are present in the execution/evaluation contract, with `unmeasured` fallback and an observable reason.
- [ ] Focused tests and static checks pass; user-confirmed root gates are run before commit, and any failures are reported with exact evidence.
- [ ] `git status --short -uall` contains only intentional engineering-repository changes; Xiaoneng 3.0 and T-MAX worktrees remain unchanged.

## Non-goals / 非目标

- This task does not promise immediate deletion of Xiaoneng or automatic replacement of every historical Xiaoneng artifact.
- This task does not make IMA a code generator, API server, authentication provider, or release system.
- This task does not fabricate a server-side IMA revision/digest when the IMA API cannot provide one.

- 本任务不承诺立即删除小能，也不自动迁移所有历史小能产物。
- 本任务不把 IMA 变成代码生成器、API 服务、鉴权提供方或发布系统。
- IMA API 无法提供服务端 revision/digest 时，不伪造版本锁。
