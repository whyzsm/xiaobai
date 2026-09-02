# 执行计划 / Implementation Plan

## Phase A: establish the migration contract / 建立迁移契约

- [x] Audit current IMA adapter, project binding, loop/harness/generator/evaluator contracts, and remaining production Xiaoneng dependencies.
- [x] Add or tighten schemas/types for explicit IMA retrieval evidence, page/API execution status, authorization/baseline locks, and stage timing.
- [x] Add focused fixtures proving fail-closed behavior and digest/scope handling.

## Phase B: migrate execution routing / 迁移执行路由

- [x] Ensure `ane-standard-page` and `frontend-delivery` use Xiaobai-owned project context and IMA evidence only.
- [x] Encode new-page, existing-page, `ApiWiring`, and `ApiIntegration` routes with explicit inputs, outputs, and blockers.
- [x] Remove any production routing requirement on Xiaoneng mounts while preserving parity fixtures as read-only tests.

## Phase C: independent verification / 独立验证

- [x] Have the supervisor agent review changed contracts against the PRD and detect scope drift.
- [x] Run focused unit/static checks first.
- [x] Ask the user before running root `npm run validate` and `npm test` because runtime/schema/config files are in scope.
- [x] Record exact results, remaining blockers, and whether stage timing is measured.
- [x] Verify the shared `t-max` IMA binding is inherited by all eight child Projects without duplicating declarations.

## Phase D: closeout / 收口

- [x] Run `git diff --check` and `git status --short -uall`.
- [x] Confirm Xiaoneng 3.0 and T-MAX business worktrees are unchanged.
- [x] Create bilingual memory checkpoint and audit after durable implementation is complete.
- [x] Do not commit or push until the user separately authorizes delivery.

## Rollback points / 回滚点

- Before Phase B: revert only engineering-repository contract changes.
- After Phase B: restore the previous Xiaobai loop/configuration and disable the new migration route; do not touch external source.
- Any IMA mismatch or missing runtime evidence blocks the affected stage rather than silently falling back to Xiaoneng.
