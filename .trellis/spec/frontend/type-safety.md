# 类型安全与结构化配置 / Type Safety And Structured Configuration

## 中文

### 类型来源

小白使用 TypeScript 和结构化配置共同定义契约：

- 跨模块类型集中在 `loop-engineering/packages/shared/src/types.ts`。
- workspace 配置由 `loop-engineering/schemas/*.schema.json` 校验。
- YAML 通过 `readYamlFile<T>` 读取成明确类型，例如 `LoopSpec`、`AgentSpec`、`ConnectorSpec`、`ProjectSpec`。
- Memory 协议的 frontmatter、index、case、pattern 类型位于 `memory-protocol`、`memory-indexer`、`memory-search` 等包中。

新增字段时，不能只改 YAML 或只改 TypeScript。要检查类型、schema、runtime 读取逻辑和测试是否都需要同步。

### Schema 校验

`loop-engineering/packages/shared/src/validation.ts` 使用 AJV 2020 加载 `loop`、`harness`、`agent`、`connector`、`budget` schema，并检查引用文件存在。它还校验 workflow stage id 唯一、stage agent/evaluator/harness 引用存在、connector 引用存在、memory discovery path 可解析。

配置变更的本地模式：

1. 更新 YAML/JSON。
2. 更新 schema。
3. 更新 `shared/src/types.ts`。
4. 更新 runtime 或 CLI 读取逻辑。
5. 补充或更新测试。

### 外部输入边界

外部输入进入系统时要在边界收窄：

- CLI flag 在 `loop-engineering/cli/loop.ts` 解析。
- Control-plane input 在 `WorkspaceControlPlane.preflight` 和 helper 函数里检查 slug、Git ref、路径和 source。
- Memory CLI 参数在 `parseMemoryArgs` 和 handler 中检查必填项。
- Connector 凭据通过环境变量引用，不能写入配置对象。

不要把未经验证的外部输入直接 cast 成内部可信类型。

## Project Context 与 IMA Contract / Project Context And IMA Contract

### 1. Scope / Trigger

本节适用于 ProjectGroup/child Project 上下文迁移、只读 IMA connector、LoopRuntime/TaskRuntime/ExecutionRuntime 之间的跨层 contract 变更。

This section applies to cross-layer contract changes spanning ProjectGroup/child Project context migration, the read-only IMA connector, and LoopRuntime/TaskRuntime/ExecutionRuntime.

### 2. Signatures / 签名

- `ProjectContextBinding`: `source`, `scope`, `revision`, `digest` 必填；`digest` 必须为 `sha256:<64 lowercase hex>`。
- `ConnectorRuntime.searchIma(request, connectorId?, transport?)` 与 `getIma(...)` 只读；IMA request 必须带 `projectScope`，search 还必须带 `query`。
- `ExecutionRuntime` 仅在输入 subject 提供显式 `imaQuery` 时调用 IMA；不得从自然语言推断查询。

- `ProjectContextBinding`: `source`, `scope`, `revision`, and `digest` are required; `digest` must be `sha256:<64 lowercase hex>`.
- `ConnectorRuntime.searchIma(request, connectorId?, transport?)` and `getIma(...)` are read-only; every IMA request requires `projectScope`, and search also requires `query`.
- `ExecutionRuntime` calls IMA only when the input subject provides explicit `imaQuery`; it must not infer a query from natural language.

### 3. Contracts / Contract

- Group bindings先于 child bindings 合并；按 `knowledgeId` 去重并稳定排序，child scope 允许 Project、Project 名称、parent group 或 group `sharedContext` scope。
- IMA result 归一化为 `id`、`noteId`、`title`、`content`、`source`、`revision`、`digest`、`scope`，并产生 `queryHash`、`selectedItemIds`、`retrievedAt`、source/revision/digest 列表。
- 新标准页 artifact 写入目标仓 `.xiaobai/runtime/tasks/<taskId>`；读取可回退到旧 `.xiaoneng/runtime/tasks/<taskId>`，以支持回滚和历史任务。

- Merge group bindings before child bindings; deduplicate by `knowledgeId` and sort deterministically. Child scope may be the Project, Project name, parent group, or group `sharedContext` scope.
- Normalize IMA results to `id`, `noteId`, `title`, `content`, `source`, `revision`, `digest`, and `scope`, and emit `queryHash`, `selectedItemIds`, `retrievedAt`, and source/revision/digest lists.
- New standard-page artifacts are written under `.xiaobai/runtime/tasks/<taskId>`; reads may fall back to `.xiaoneng/runtime/tasks/<taskId>` for rollback and historical tasks.

### 4. Validation & Error Matrix / 校验与错误矩阵

| 条件 / Condition | 结果 / Result |
| --- | --- |
| 缺 source、revision、合法 digest 或 scope 越界 / missing required binding fields or out-of-scope | 配置加载失败 / configuration fails closed |
| IMA MCP 未加载、connector 缺失或 transport 未注入 / MCP, connector, or transport unavailable | `not-loaded`，阶段 failed，不调用模型补全 / stage fails without model completion |
| 无 `imaQuery`、空结果或 scope 不匹配 / no query, empty result, or scope mismatch | `invalid-response` / `empty-result` / `out-of-scope`，阶段 failed |
| revision 或 digest 不匹配 / revision or digest mismatch | `digest-mismatch`，阻断执行 / execution blocked |
| 401/403、超时或未知传输错误 / 401/403, timeout, or unknown transport error | `permission` / `timeout` / `transport`，保留 evidence / preserve evidence |

### 5. Good / Base / Bad Cases / 正反例

- Good：`tmax-dcm` 使用显式 `imaQuery`，按 `tmax-dcm` scope 检索，并把选中项和 digest 写入 `ima-retrieval.json`。
- Base：没有 IMA transport 时 dry-run 和建 task 仍可完成，但依赖 IMA 的 execution stage 必须 fail closed。
- Bad：把 IMA knowledge id、token、个人路径写入 Project YAML，或在查询失败时使用模型记忆继续编码。

- Good: `tmax-dcm` supplies an explicit `imaQuery`, searches within `tmax-dcm`, and writes selected items and digests to `ima-retrieval.json`.
- Base: dry-run and task creation may complete without an IMA transport, but an IMA-dependent execution stage must fail closed.
- Bad: storing an IMA knowledge id, token, or personal path in Project YAML, or continuing implementation from model memory after a failed query.

### 6. Tests Required / 必需测试

- IMA adapter：search/get、去重、字符预算、scope、digest、空结果、权限、超时、not-loaded 和敏感字段 schema。
- Runtime：无 background 的 `tmax-dcm` dry-run、显式 query retrieval、evidence artifact、legacy background fixture、标准页 artifact 新路径与旧路径回退。
- Config：group/child binding 合并、sharedContext scope、无 background child 创建更新和 local paths 仍归 group。

- IMA adapter: search/get, deduplication, character budgets, scope, digest, empty result, permission, timeout, not-loaded, and sensitive-field schema tests.
- Runtime: background-free `tmax-dcm` dry-run, explicit-query retrieval, evidence artifact, legacy-background fixture, and new/legacy standard-page artifact paths.
- Config: group/child binding merge, sharedContext scope, background-free child create/update, and group-owned local paths.

### 7. Wrong vs Correct / 错误与正确

错误 / Wrong:

```yaml
background:
  id: xiaoneng
knowledgeBindings:
  - source: ima
    digest: pending
```

正确 / Correct:

```yaml
knowledgeBindings:
  - knowledgeId: know_tmax_dcm_ima
    source: ima
    scope: tmax-dcm
    revision: <resolved-at-runtime>
    digest: sha256:<64-hex>
    readOnly: true
```

旧 `background` 仅作为兼容读取输入；新的 Project 配置、runtime evidence 和 artifact 写入不得依赖 Xiaoneng checkout。

Legacy `background` is compatibility-read input only; new Project configuration, runtime evidence, and artifact writes must not depend on a Xiaoneng checkout.

### 路径与安全

路径判断优先使用现有 helper，例如 `resolveWorkspacePath`、`resolveMemoryPath`、`pathExists`、`containsPath` 和 `resolveSafeWritePath`。涉及本机路径时，要区分 workspace 相对路径、Obsidian vault 路径、T-MAX 挂载路径和 OpenHands 容器路径。

### 禁止模式

- 不要新增无约束的 `any`。
- 不要用裸字符串复制 schema 枚举。
- 不要手写 YAML/JSON 字符串拼接来生成结构化配置。
- 不要在 schema、类型和测试不同步时声称配置能力完成。
- 不要把本机路径存在性当成跨机器有效的类型保证。

## English

### Type Sources

Xiaobai uses TypeScript and structured configuration together to define contracts:

- Cross-module types live in `loop-engineering/packages/shared/src/types.ts`.
- Workspace configuration is validated by `loop-engineering/schemas/*.schema.json`.
- YAML is loaded through `readYamlFile<T>` into explicit types such as `LoopSpec`, `AgentSpec`, `ConnectorSpec`, and `ProjectSpec`.
- Memory protocol types for frontmatter, indexes, cases, and patterns live across `memory-protocol`, `memory-indexer`, `memory-search`, and related packages.

When adding a field, do not change only YAML or only TypeScript. Check whether types, schemas, runtime readers, and tests all need to change together.

### Schema Validation

`loop-engineering/packages/shared/src/validation.ts` uses AJV 2020 to load the `loop`, `harness`, `agent`, `connector`, and `budget` schemas, and it checks referenced files. It also validates unique workflow stage ids, stage agent/evaluator/harness references, connector references, and memory discovery path resolution.

The local pattern for configuration changes is:

1. Update YAML or JSON.
2. Update the schema.
3. Update `shared/src/types.ts`.
4. Update runtime or CLI readers.
5. Add or update tests.

### External Input Boundaries

External input must be narrowed at the boundary:

- CLI flags are parsed in `loop-engineering/cli/loop.ts`.
- Control-plane input is checked in `WorkspaceControlPlane.preflight` and helper functions for slugs, Git refs, paths, and sources.
- Memory CLI arguments are checked in `parseMemoryArgs` and command handlers.
- Connector credentials reference environment variables and must not be written into configuration objects.

Do not cast unvalidated external input directly into trusted internal types.

### Paths And Safety

Prefer existing helpers for path handling, such as `resolveWorkspacePath`, `resolveMemoryPath`, `pathExists`, `containsPath`, and `resolveSafeWritePath`. For machine paths, distinguish workspace-relative paths, Obsidian vault paths, T-MAX mount paths, and OpenHands container paths.

### Forbidden Patterns

- Do not add unconstrained `any`.
- Do not duplicate schema enum values as scattered raw strings.
- Do not generate structured YAML/JSON by ad hoc string concatenation.
- Do not claim a configuration capability is complete when schema, types, and tests are out of sync.
- Do not treat machine-local path existence as a cross-machine type guarantee.
