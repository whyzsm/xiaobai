# 小白仓库级开发规范 / Xiaobai Repository Development Guidelines

## 中文

### 范围

Trellis 初始化时自动创建了 `.trellis/spec/frontend/`。小白不是普通前端应用，而是 Loop Engineering 工程骨架，所以本目录在当前仓库中作为“仓库级规范层”使用。后续如要重命名为 `repository` 或拆分更多 spec 层，必须先按根 `AGENTS.md` 的创建、删除和批量操作规则取得确认。

这些规范适用于本小白工程仓，不适用于通过 `workspace/.local/` 挂载进入的 T-MAX 业务仓。进入业务仓工作时，应先读取对应项目的 `workspace/projects/<project>/SKILL.md` 和目标仓自身状态。

### 使用顺序

1. 先读根 `AGENTS.md`，获得语言、提交边界、本机状态、OpenHands、memory 和人工门禁规则。
2. 再读根 `SKILL.md`，获得 Loop Engineering 实现阶段规则。
3. 按任务读取本目录下的具体规范文件。
4. 需要 T-MAX 或 HarmonyWardrobe 等项目背景时，再叠加 `workspace/projects/<project>/SKILL.md`。

### 规范索引

| 文件 | 约束内容 | 状态 |
| --- | --- | --- |
| [Directory Structure](./directory-structure.md) | `loop-engineering/`、`workspace/`、`deploy/openhands/`、本机挂载和分发边界 | current |
| [Component Guidelines](./component-guidelines.md) | Loop capability、agent、harness、connector、control-plane 的组合方式 | current |
| [Hook Guidelines](./hook-guidelines.md) | CLI、runtime、preflight、side effect 和写入流程 | current |
| [State Management](./state-management.md) | workspace 状态、Obsidian memory、Trellis 状态、本机忽略状态和 OpenHands runtime | current |
| [Type Safety](./type-safety.md) | TypeScript 类型、YAML/JSON Schema、AJV 校验和外部输入边界 | current |
| [Quality Guidelines](./quality-guidelines.md) | 验证命令、人工门禁、Git 边界、memory checkpoint 和 Trellis 收尾 | current |

### 主要证据文件

- `AGENTS.md`
- `SKILL.md`
- `package.json`
- `loop-engineering/docs/architecture.md`
- `loop-engineering/docs/obsidian-memory-architecture.md`
- `loop-engineering/docs/frontend-platform-standards.md`
- `loop-engineering/cli/loop.ts`
- `loop-engineering/cli/memory.ts`
- `loop-engineering/packages/loop-runtime/src/loopRuntime.ts`
- `loop-engineering/packages/project-registry/src/projectRegistry.ts`
- `loop-engineering/packages/shared/src/validation.ts`
- `loop-engineering/packages/shared/src/types.ts`
- `loop-engineering/packages/control-plane/src/workspaceControlPlane.ts`
- `workspace/agents/xiaobai.orchestrator.agent.yaml`
- `workspace/projects/t-max/.loop/project.yaml`
- `deploy/openhands/README.md`
- `loop-engineering/tests/runtime.test.ts`
- `loop-engineering/tests/memory-cli.test.ts`

## English

### Scope

Trellis created `.trellis/spec/frontend/` during initialization. Xiaobai is not a regular frontend app; it is a Loop Engineering scaffold. In this repository, this directory is used as the repository-level guideline layer. If a future change should rename it to `repository` or split additional spec layers, obtain confirmation first under the create, delete, and batch-operation rules in the root `AGENTS.md`.

These guidelines apply to this Xiaobai engineering repository. They do not apply directly to T-MAX business repositories mounted through `workspace/.local/`. For business-repository work, first read the matching `workspace/projects/<project>/SKILL.md` and inspect the target repository's own state.

### Loading Order

1. Read root `AGENTS.md` first for language, commit boundaries, local state, OpenHands, memory, and human-gate rules.
2. Read root `SKILL.md` next for Loop Engineering implementation rules.
3. Read the relevant guideline files in this directory.
4. When a task needs T-MAX, HarmonyWardrobe, or another project background, layer in `workspace/projects/<project>/SKILL.md`.

### Guideline Index

| File | What it governs | Status |
| --- | --- | --- |
| [Directory Structure](./directory-structure.md) | Boundaries for `loop-engineering/`, `workspace/`, `deploy/openhands/`, local mounts, and distribution files | current |
| [Component Guidelines](./component-guidelines.md) | Composition of Loop capabilities, agents, harnesses, connectors, and the control plane | current |
| [Hook Guidelines](./hook-guidelines.md) | CLI, runtime, preflight, side effects, and write flows | current |
| [State Management](./state-management.md) | Workspace state, Obsidian memory, Trellis state, ignored local state, and OpenHands runtime state | current |
| [Type Safety](./type-safety.md) | TypeScript types, YAML/JSON Schema, AJV validation, and external-input boundaries | current |
| [Quality Guidelines](./quality-guidelines.md) | Verification commands, human gates, Git boundaries, memory checkpoints, and Trellis closeout | current |

### Evidence Files

- `AGENTS.md`
- `SKILL.md`
- `package.json`
- `loop-engineering/docs/architecture.md`
- `loop-engineering/docs/obsidian-memory-architecture.md`
- `loop-engineering/docs/frontend-platform-standards.md`
- `loop-engineering/cli/loop.ts`
- `loop-engineering/cli/memory.ts`
- `loop-engineering/packages/loop-runtime/src/loopRuntime.ts`
- `loop-engineering/packages/project-registry/src/projectRegistry.ts`
- `loop-engineering/packages/shared/src/validation.ts`
- `loop-engineering/packages/shared/src/types.ts`
- `loop-engineering/packages/control-plane/src/workspaceControlPlane.ts`
- `workspace/agents/xiaobai.orchestrator.agent.yaml`
- `workspace/projects/t-max/.loop/project.yaml`
- `deploy/openhands/README.md`
- `loop-engineering/tests/runtime.test.ts`
- `loop-engineering/tests/memory-cli.test.ts`
