# Frontend Delivery Loop V2 Implementation Plan

> **For implementer:** Use TDD for schema, validation, and runtime behavior. Write failing tests first, watch them fail, then implement.
>
> **给实现者：** schema、校验和 runtime 行为变更必须使用 TDD。先写失败测试，确认失败，再实现。

**Goal:** Upgrade `frontend-delivery` from a gate-encoded v1 loop into an explicit staged workflow with `workflow.stages[]`, stage reference validation, runtime stage planning, and Yuque connector API configuration shape.

**目标：** 将 `frontend-delivery` 从 v1 的门禁编码式 loop 升级为显式 `workflow.stages[]` 阶段流，支持阶段引用校验、runtime 阶段计划，以及语雀 connector API 配置结构。

**Architecture:** Keep v1 fields for backwards compatibility. Add optional `workflow.stages[]` to loop specs and optional `config/auth` to connectors. Runtime dry-run exposes a `workflow` plan but still does not execute real Yuque calls, branch creation, PR creation, or business repository writes.

**架构：** 保留 v1 字段以兼容现有 loop。为 loop spec 增加可选 `workflow.stages[]`，为 connector 增加可选 `config/auth`。runtime dry-run 输出 `workflow` 计划，但仍不真实调用语雀、不创建分支、不创建 PR、不写业务仓。

---

### Task 1: Add Workflow Schema And Types

**Files:**
- Modify: `loop-engineering/schemas/loop.schema.json`
- Modify: `loop-engineering/packages/shared/src/types.ts`
- Modify: `workspace/loops/frontend-delivery.loop.yaml`

**Test first:** Add assertions that `frontend-delivery` has ordered workflow stages in dry-run output.

**先写测试：** 添加断言，要求 `frontend-delivery` dry-run 输出有有序 workflow stages。

### Task 2: Validate Stage References

**Files:**
- Modify: `loop-engineering/packages/shared/src/validation.ts`
- Modify: `loop-engineering/tests/runtime.test.ts`

**Test first:** Create a temporary loop with a missing workflow stage agent/evaluator/harness and assert validation fails with a clear missing-file error.

**先写测试：** 创建临时 loop，引用不存在的 workflow stage agent/evaluator/harness，并断言校验返回明确缺失文件错误。

### Task 3: Add Runtime Workflow Plan

**Files:**
- Modify: `loop-engineering/packages/loop-runtime/src/loopRuntime.ts`
- Modify: `loop-engineering/packages/shared/src/types.ts`
- Modify: `loop-engineering/tests/runtime.test.ts`

**Test first:** Assert `plan.workflow.stages` includes stage id, kind, gate mode, agent/evaluator/harness ids, required checks, outputs, and `status: planned`.

**先写测试：** 断言 `plan.workflow.stages` 包含阶段 id、kind、gate mode、agent/evaluator/harness id、required checks、outputs 和 `status: planned`。

### Task 4: Add Yuque Connector API Shape

**Files:**
- Modify: `loop-engineering/schemas/connector.schema.json`
- Modify: `loop-engineering/packages/shared/src/types.ts`
- Modify: `workspace/connectors/yuque.yaml`
- Modify: `loop-engineering/tests/runtime.test.ts`

**Test first:** Assert `yuque.yaml` validates with `config.baseUrl` and `auth.tokenEnv`, while no token value is stored.

**先写测试：** 断言 `yuque.yaml` 携带 `config.baseUrl` 与 `auth.tokenEnv` 后能通过校验，并且不保存 token 值。

### Task 5: Update Bilingual Docs And Skills

**Files:**
- Modify: `README.md`
- Modify: `workspace/projects/t-max/.loop/skills/frontend-delivery.SKILL.md`
- Modify: `workspace/projects/t-max/.loop/skills/frontend-design-review.SKILL.md`

**Verification:** `npm run validate`, `npm run dry-run`, `npm run loop -- dry-run --json --loop frontend-delivery`, and `npm test`.

**验证：** `npm run validate`、`npm run dry-run`、`npm run loop -- dry-run --json --loop frontend-delivery` 和 `npm test`。
