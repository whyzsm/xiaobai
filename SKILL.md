---
name: loop-engineering-implementation
description: Loop Engineering repository-level implementation skill for coding phases. Use when implementing code changes, bug fixes, refactors, tests, or frontend/backend changes in this repository; enforces explicit assumptions, simplicity, surgical changes, and goal-driven verification. / Loop Engineering 工程仓级代码实现技能，用于代码修改、缺陷修复、重构、测试补充和前后端实现阶段；要求显式假设、简洁优先、精准修改和目标驱动验证。
---

# Loop 工程仓级实现 Skill / Loop Engineering Repository Implementation Skill

## 中文

## 目标

本 Skill 是 Loop Engineering 工程仓的仓级代码实现规范，用于 generator agent、编码 harness 和人工协作进入实现阶段时统一执行口径。

它改编自 `multica-ai/andrej-karpathy-skills` 的编程行为原则，但落点是本仓库的 loop 工程边界：可维护、可审计、可验证，且必须与项目级 `SKILL.md`、loop spec、harness 和 evaluator 规则共同工作。

来源参考：`https://github.com/multica-ai/andrej-karpathy-skills`。本仓只纳入实现阶段原则，不复制外部仓的 Claude/Cursor 插件安装配置。

## 适用阶段

在以下任务中启用本 Skill：

- 实现代码改动、修复 bug、补测试、做重构或接入新 runtime 能力。
- 从已批准的设计进入编码实现，例如 `frontend-delivery` 的 `frontend-implementation` 阶段。
- 修改 `loop-engineering/` 引擎代码、`workspace/` loop 配置、agent/harness 配置、schema 或测试。
- 对用户要求的代码实现进行评审前自检。

纯讨论、需求澄清、架构设计、文档整理可以参考本 Skill，但不得把“已思考”当作“已实现”。进入编码前仍要重新应用本 Skill。

## 加载顺序

实现阶段的上下文优先级：

1. `AGENTS.md`：仓库协作语言、提交边界、本机状态和工程硬约束。
2. 根目录 `SKILL.md`：本仓级实现规则。
3. `loop-engineering/docs/**`：平台规范和架构说明，例如前端平台工程规范。
4. `workspace/projects/<project>/SKILL.md`：项目级或项目组级规则。
5. loop spec、harness、agent 配置、memory、connector evidence 和任务上下文。

当规则冲突时，优先遵守更高层级的安全、边界和验证要求；项目级规则只能收窄实现方式，不能降低仓级安全和验证标准。

## 四条实现原则

### 1. 编码前思考

不要默认假设，不要隐藏困惑，不要把歧义静默变成实现。

实现前必须做到：

- 明确当前假设、目标文件、验证方式和可能影响范围。
- 如果任务有多种合理解释，先说明差异；无法安全判断时向用户澄清。
- 如果用户方案明显更复杂、风险更高或偏离仓库边界，提出更小的实现切口。
- 如果需求、路径、依赖、数据来源或权限不清楚，先定位事实；定位不了再停止并说明阻塞点。

### 2. 简洁优先

用能满足目标的最少代码解决问题，不做投机式扩展。

实现时必须避免：

- 添加用户没有要求、loop 没有规划、测试无法覆盖的功能。
- 为单次使用逻辑新增抽象、框架、插件或配置层。
- 为不真实存在的场景写大段防御代码。
- 把小修复扩大成目录迁移、架构重写或通用平台建设。

如果实现已经明显膨胀，先收缩方案，再继续编码。

### 3. 精准修改

只改完成任务必须改的内容，只清理本次改动制造的问题。

修改现有代码时必须做到：

- 保持既有目录边界、模块职责、命名风格和测试风格。
- 不顺手格式化无关文件，不重构未要求的相邻代码。
- 不删除自己没有完全理解且与任务无关的注释、逻辑、配置或历史兼容路径。
- 可以移除由本次改动造成的未使用 import、变量、函数、测试夹具或配置引用。
- 发现无关死代码或风险时，在交付说明或评审意见中记录，不擅自删除。

检验标准：每一行 diff 都能追溯到用户请求、loop finding、设计门禁或验证要求。

### 4. 目标驱动执行

把“做一个修改”转成可验证目标，并循环直到目标达成或明确阻塞。

开始实现前，为任务定义成功标准：

- 修复 bug：优先找到或补充能复现问题的测试，再让测试通过。
- 新增能力：明确输入、输出、配置、schema、错误路径和用户可见行为。
- 重构：确认重构前后的行为等价，测试或快照能证明没有回归。
- 前端实现：覆盖主要状态、桌面/移动布局和用户可见交互；必要时使用浏览器截图或 UI 冒烟验证。

多步骤任务使用简短计划，每一步都带验证方式：

```text
1. 定位事实 -> 验证：读相关文件、schema、测试和现有调用点
2. 实现最小改动 -> 验证：运行聚焦测试或构建检查
3. 收口 diff -> 验证：检查 git diff、无关改动和交付说明
```

## Loop 实现门禁

实现阶段完成前至少确认：

- 已读取并遵守仓级 Skill 与目标项目 Skill。
- 改动没有写入 ignored 本机状态、外部挂载仓内容或无关 workspace 状态。
- schema、配置、runtime、memory、connector、agent 或 harness 的修改有对应验证。
- generator 没有把自评作为完成条件；需要 evaluator 或等价独立检查的任务已保留门禁。
- 无法运行验证时，交付说明必须写明原因、风险和下一步最小验证方式。

## 输出要求

交付实现时说明：

- 改了什么，为什么这些文件必须改。
- 运行了哪些验证命令，结果如何。
- 哪些风险未覆盖，是否需要人工门禁、设计审批或独立 evaluator。
- 是否存在本次发现但未处理的无关问题。

## English

## Goal

This Skill is the repository-level implementation standard for the Loop Engineering repository. It aligns generator agents, coding harnesses, and human collaboration during coding phases.

It adapts the programming behavior principles from `multica-ai/andrej-karpathy-skills`, but its target is this repository's loop engineering boundary: maintainable, auditable, and verifiable work that cooperates with project-level `SKILL.md` files, loop specs, harnesses, and evaluator rules.

Source reference: `https://github.com/multica-ai/andrej-karpathy-skills`. This repository incorporates only the implementation-phase principles, not the external repository's Claude/Cursor plugin installation configuration.

## Applicable Phase

Use this Skill for:

- Implementing code changes, fixing bugs, adding tests, refactoring, or adding runtime capabilities.
- Moving from approved design into implementation, such as the `frontend-delivery` loop's `frontend-implementation` stage.
- Changing `loop-engineering/` engine code, `workspace/` loop configuration, agent/harness configuration, schemas, or tests.
- Self-checking code implementation before review.

Pure discussion, requirement clarification, architecture design, and documentation work may refer to this Skill, but "thought through" must not be treated as "implemented." Apply this Skill again before coding begins.

## Loading Order

Implementation-phase context priority:

1. `AGENTS.md`: repository collaboration language, commit boundaries, local state, and hard engineering constraints.
2. Root `SKILL.md`: this repository-level implementation rule set.
3. `loop-engineering/docs/**`: platform standards and architecture notes, such as the frontend platform engineering standard.
4. `workspace/projects/<project>/SKILL.md`: project-level or project-group rules.
5. Loop specs, harnesses, agent configs, memory, connector evidence, and task context.

When rules conflict, follow the stricter safety, boundary, and verification requirement from the higher level. Project-level rules may narrow implementation choices, but they must not weaken repository-level safety or verification standards.

## Four Implementation Principles

### 1. Think Before Coding

Do not assume silently, hide confusion, or turn ambiguity into implementation without naming it.

Before implementation:

- State current assumptions, target files, verification method, and possible impact.
- If the task has multiple reasonable interpretations, describe the difference first; ask the user when it is unsafe to choose.
- If the requested approach is clearly more complex, riskier, or outside repository boundaries, propose a smaller implementation path.
- If requirements, paths, dependencies, data sources, or permissions are unclear, inspect facts first; if facts cannot be established, stop and state the blocker.

### 2. Simplicity First

Use the least code that satisfies the goal. Do not add speculative flexibility.

Avoid:

- Adding functionality that the user did not request, the loop did not plan, or tests cannot cover.
- Adding abstractions, frameworks, plugins, or configuration layers for single-use logic.
- Writing large defensive branches for scenarios that do not realistically exist.
- Expanding a small fix into directory migration, architecture rewrite, or platform buildout.

If the implementation is visibly growing beyond the task, shrink the approach before continuing.

### 3. Surgical Changes

Change only what is necessary for the task, and clean up only problems introduced by this change.

When editing existing code:

- Preserve existing directory boundaries, module responsibilities, naming style, and test style.
- Do not opportunistically format unrelated files or refactor adjacent code.
- Do not delete comments, logic, configuration, or compatibility paths that you do not fully understand and that are unrelated to the task.
- Remove imports, variables, functions, fixtures, or configuration references that this change made unused.
- If unrelated dead code or risk is found, record it in the handoff or review notes instead of deleting it.

Diff test: every changed line must trace back to the user request, loop finding, design gate, or verification requirement.

### 4. Goal-Driven Execution

Turn "make a change" into a verifiable goal, then loop until the goal is met or the blocker is explicit.

Define success criteria before implementation:

- Bug fix: prefer finding or adding a test that reproduces the problem, then make it pass.
- New capability: define inputs, outputs, configuration, schema, error paths, and user-visible behavior.
- Refactor: prove behavior equivalence before and after with tests or snapshots.
- Frontend implementation: cover major states, desktop/mobile layout, and user-visible interactions; use browser screenshots or UI smoke checks when needed.

For multi-step tasks, use a short plan where each step has a verification method:

```text
1. Establish facts -> verify: read relevant files, schemas, tests, and call sites
2. Implement the minimal change -> verify: run focused tests or build checks
3. Close the diff -> verify: inspect git diff, unrelated changes, and handoff notes
```

## Loop Implementation Gates

Before completing an implementation phase, confirm at least:

- The repository-level Skill and target project Skill were read and followed.
- The change did not write ignored local state, external mounted repository contents, or unrelated workspace state.
- Schema, configuration, runtime, memory, connector, agent, or harness changes have matching verification.
- Generator self-review is not used as the completion gate; tasks requiring evaluator or equivalent independent checks preserve that gate.
- If verification could not run, the handoff states the reason, risk, and smallest next verification step.

## Output Requirements

When handing off an implementation, state:

- What changed and why those files had to change.
- Which verification commands ran and what happened.
- Which risks remain uncovered and whether human gate, design approval, or independent evaluator review is needed.
- Whether any unrelated issue was noticed but intentionally not changed.
