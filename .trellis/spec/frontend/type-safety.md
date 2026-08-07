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
