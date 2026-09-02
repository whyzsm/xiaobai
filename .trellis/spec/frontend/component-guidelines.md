# 能力组合规范 / Capability Composition Guidelines

## 中文

### 组件含义

在小白仓库里，“组件”主要不是 UI component，而是可审计的工程能力单元：runtime package、CLI command、schema、loop YAML、agent YAML、harness、connector、memory writer、project registry 和 OpenHands adapter。

### 组合模式

- CLI 入口只负责解析参数、选择命令和调用 runtime。参考 `loop-engineering/cli/loop.ts`。
- 业务能力放在 `loop-engineering/packages/<capability>/src/`，例如 `loop-runtime` 组装 scheduler、budget、memory、skill、connector、worktree、agent、evaluator 和 human gate。
- 结构化契约放在 `loop-engineering/packages/shared/src/types.ts` 和 `loop-engineering/schemas/`，不要把契约藏在提示词或临时字符串里。
- 工作流组合放在 `workspace/loops/*.loop.yaml`，agent 组合放在 `workspace/agents/*.yaml`。
- 项目背景和挂载路由放在 `workspace/projects/<project>/.loop/project.yaml`，本机真实路径放在 ignored 的 `local.paths.yaml`。
- OpenHands 只作为可视化执行面和分发适配层；小白仍是 workspace/background/control-plane 真源。

### Agent 与 evaluator

- `workspace/agents/xiaobai.orchestrator.agent.yaml` 负责先解析目标项目或目标仓，再选择 loop、项目 skill 和背景。
- generator 与 evaluator 必须分离。`runtime.test.ts` 明确断言 `allowSelfReview === false`。
- `frontend-delivery` 这类复杂流程必须保留设计审批、实现、验证和 PR readiness 阶段；不能把 generator 自评当作完成条件。

### 新增能力时

新增 runtime 能力时，优先复用现有包形态：

1. 在 `loop-engineering/packages/<capability>/src/` 放核心逻辑。
2. 在 `loop-engineering/packages/shared/src/types.ts` 添加跨模块类型。
3. 在 `loop-engineering/schemas/` 更新对应 schema。
4. 在 `loop-engineering/cli/` 只放命令分派和输入边界。
5. 在 `loop-engineering/tests/` 添加覆盖 routing、validation、memory 或 command 行为的测试。

### 禁止模式

- 不要新增一个横跨 CLI、schema、memory、project routing 和 OpenHands 的大模块。
- 不要在 agent 文档里定义 runtime 唯一契约。
- 不要复制 Xiaoneng 或 T-MAX 的编排状态作为小白第二套真源。
- 不要在 `deploy/openhands/` 里绕过小白 control-plane 写 workspace 或 background。

## English

### Meaning Of Component

In this repository, a "component" is usually not a UI component. It is an auditable engineering capability: a runtime package, CLI command, schema, loop YAML, agent YAML, harness, connector, memory writer, project registry, or OpenHands adapter.

### Composition Pattern

- CLI entrypoints parse arguments, select commands, and call runtimes. See `loop-engineering/cli/loop.ts`.
- Business capabilities live under `loop-engineering/packages/<capability>/src/`. For example, `loop-runtime` composes scheduler, budget, memory, skill, connector, worktree, agent, evaluator, and human gate.
- Structured contracts live in `loop-engineering/packages/shared/src/types.ts` and `loop-engineering/schemas/`. Do not hide contracts in prompts or ad hoc strings.
- Workflow composition lives in `workspace/loops/*.loop.yaml`; agent composition lives in `workspace/agents/*.yaml`.
- Project background and mount routing live in `workspace/projects/<project>/.loop/project.yaml`; real local paths live in ignored `local.paths.yaml`.
- OpenHands is only the visual execution plane and distribution adapter. Xiaobai remains the source of truth for workspace, background, and control-plane behavior.

### Agents And Evaluators

- `workspace/agents/xiaobai.orchestrator.agent.yaml` resolves the target project or repository before selecting the loop, project skill, and background.
- Generator and evaluator responsibilities must stay separate. `runtime.test.ts` asserts `allowSelfReview === false`.
- Complex flows such as `frontend-delivery` must preserve design approval, implementation, verification, and PR readiness stages. Generator self-review is not a completion condition.

### Adding Capabilities

When adding a runtime capability, follow the existing package shape:

1. Put core logic under `loop-engineering/packages/<capability>/src/`.
2. Add cross-module types in `loop-engineering/packages/shared/src/types.ts`.
3. Update the matching schema under `loop-engineering/schemas/`.
4. Keep `loop-engineering/cli/` limited to command dispatch and input boundaries.
5. Add tests under `loop-engineering/tests/` that cover routing, validation, memory, or command behavior.

### Forbidden Patterns

- Do not add one large module that spans CLI, schema, memory, project routing, and OpenHands.
- Do not define the only runtime contract inside agent documentation.
- Do not duplicate Xiaoneng or T-MAX orchestration state as a second Xiaobai source of truth.
- Do not bypass the Xiaobai control plane from `deploy/openhands/` when writing workspace or background state.
