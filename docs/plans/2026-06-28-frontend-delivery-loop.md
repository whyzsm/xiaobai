# Frontend Delivery Loop Implementation Plan

> **For implementer:** Use TDD where runtime behavior changes. Write a failing test first, watch it fail, then implement. Configuration and Markdown-only tasks are verified through `npm run validate` and targeted assertions.
>
> **给实现者：** 涉及运行时行为变更时必须使用 TDD。先写失败测试，确认失败，再实现。纯配置和 Markdown 任务通过 `npm run validate` 与定向断言验证。

**Goal:** Add a reusable `frontend-delivery` loop that takes requirements from local documents, conversation input, or Yuque API, gates frontend technical design before coding, then prepares PR-ready frontend delivery in dynamically mounted repositories.

**目标：** 新增可复用的 `frontend-delivery` loop，支持从本地文档、对话输入或语雀 API 接入需求，在编码前通过前端技术设计门禁，再把动态挂载仓推进到 PR 就绪。

**Architecture:** Version 1 uses the existing loop schema and runtime contract. Multi-stage behavior is represented through loop `requiredChecks`, agent instructions, harness completion conditions, and project skills, while business design/code artifacts stay inside mounted target repositories.

**架构：** v1 复用现有 loop schema 和 runtime 合约。多阶段行为通过 loop 的 `requiredChecks`、agent 指令、harness 完成条件和项目 Skill 表达，业务设计/代码产物只落在挂载目标仓。

**Tech Stack:** Node.js, TypeScript, YAML loop specs, Markdown Skills, JSON Schema validation.

**技术栈：** Node.js、TypeScript、YAML loop 配置、Markdown Skills、JSON Schema 校验。

---

### Task 1: Add Frontend Delivery Configuration

**Files:**
- Create: `workspace/loops/frontend-delivery.loop.yaml`
- Create: `workspace/connectors/yuque.yaml`
- Create: `workspace/agents/frontend-delivery.harness.yaml`
- Create: `workspace/agents/frontend-generator.agent.yaml`
- Create: `workspace/agents/frontend-evaluator.agent.yaml`
- Create: `workspace/memory/loops/frontend-delivery/state.md`
- Create: `workspace/memory/loops/frontend-delivery/inbox.md`
- Create: `workspace/memory/loops/frontend-delivery/runs.jsonl`
- Create: `workspace/memory/loops/frontend-delivery/findings.jsonl`
- Create: `workspace/memory/loops/frontend-delivery/metrics.jsonl`

**Step 1: Write the failing test**
Add assertions to `loop-engineering/tests/runtime.test.ts` that `frontend-delivery` validates, exposes `human-design-approval`, includes `yuque` evidence, and keeps merge protected.

**步骤 1：写失败测试**
在 `loop-engineering/tests/runtime.test.ts` 添加断言，要求 `frontend-delivery` 能通过校验，包含 `human-design-approval`、暴露 `yuque` evidence，并保护 merge。

**Step 2: Run test and confirm it fails**
Command: `npm test`
Expected: FAIL because `workspace/loops/frontend-delivery.loop.yaml` does not exist yet.

**步骤 2：运行测试并确认失败**
命令：`npm test`
预期：失败，因为 `workspace/loops/frontend-delivery.loop.yaml` 尚不存在。

**Step 3: Add minimal configuration**
Create the loop, connector, agents, harness, and memory files. Use project `t-max` as the dynamic mounted project group. Encode design review and human approval as required checks and completion conditions.

**步骤 3：添加最小配置**
创建 loop、connector、agent、harness 和 memory 文件。使用 `t-max` 作为动态挂载项目组。把设计评审和人工确认编码到 required checks 与完成条件中。

**Step 4: Run test and confirm it passes**
Command: `npm test`
Expected: PASS.

**步骤 4：运行测试并确认通过**
命令：`npm test`
预期：通过。

### Task 2: Add Frontend Delivery Skills

**Files:**
- Create: `workspace/projects/t-max/.loop/skills/frontend-delivery.SKILL.md`
- Create: `workspace/projects/t-max/.loop/skills/frontend-master-design.SKILL.md`
- Create: `workspace/projects/t-max/.loop/skills/frontend-repository-design.SKILL.md`
- Create: `workspace/projects/t-max/.loop/skills/frontend-design-review.SKILL.md`
- Modify: `workspace/projects/t-max/SKILL.md`

**Step 1: Write the failing test**
Add assertions that the frontend delivery skill contains Yuque intake, dynamic mounted repository rules, master plus repository supplement design docs, independent design review, and human design approval before coding.

**步骤 1：写失败测试**
添加断言，要求 frontend delivery Skill 包含语雀接入、动态挂载仓规则、主设计与仓内补充设计、独立设计评审，以及编码前人工确认。

**Step 2: Run test and confirm it fails**
Command: `npm test`
Expected: FAIL because the skill files do not exist yet.

**步骤 2：运行测试并确认失败**
命令：`npm test`
预期：失败，因为 Skill 文件尚不存在。

**Step 3: Add bilingual skills**
Create concise bilingual Markdown skills. Keep hard gates explicit: no coding before `human-design-approval`; no business artifacts in the engineering repository; each target repository owns its design supplement and code.

**步骤 3：添加双语 Skill**
创建简洁的中英双语 Markdown Skill。明确硬门禁：`human-design-approval` 前不得编码；业务产物不得落工程仓；各目标仓负责自己的补充设计和代码。

**Step 4: Run test and confirm it passes**
Command: `npm test`
Expected: PASS.

**步骤 4：运行测试并确认通过**
命令：`npm test`
预期：通过。

### Task 3: Add Runtime/Test Coverage for Multiple Loops

**Files:**
- Modify: `loop-engineering/tests/runtime.test.ts`
- Possibly modify: `loop-engineering/packages/shared/src/validation.ts`

**Step 1: Write the failing test**
Ensure both `morning-triage` and `frontend-delivery` validate independently. Assert frontend dry-run includes the design gate checks and does not create engineering-repo business artifact paths.

**步骤 1：写失败测试**
确保 `morning-triage` 与 `frontend-delivery` 都能独立校验。断言 frontend dry-run 包含设计门禁检查，且不产生工程仓业务产物路径。

**Step 2: Run test and confirm it fails**
Command: `npm test`
Expected: FAIL until Task 1 and Task 2 files exist.

**步骤 2：运行测试并确认失败**
命令：`npm test`
预期：在 Task 1 和 Task 2 文件存在前失败。

**Step 3: Implement minimal test-compatible behavior**
Prefer configuration-only changes. Only adjust validation if a referenced-file check is too rigid for dynamic mounted repositories.

**步骤 3：实现最小测试兼容行为**
优先使用配置改动。如果引用文件校验对动态挂载仓过于刚性，再最小调整 validation。

**Step 4: Run full verification**
Commands:
- `npm run validate -- --loop frontend-delivery`
- `npm run dry-run -- --loop frontend-delivery`
- `npm test`

**步骤 4：运行完整验证**
命令：
- `npm run validate -- --loop frontend-delivery`
- `npm run dry-run -- --loop frontend-delivery`
- `npm test`

Expected: all PASS.

预期：全部通过。
