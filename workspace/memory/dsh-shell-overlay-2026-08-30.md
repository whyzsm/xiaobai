# dsh shell.overlay 首屏空白修复 / dsh shell.overlay Blank First-Screen Fix

## 结论 / Outcome

dsh `shell.overlay` 是独立的 Client Slot，不能依赖 `settings.section` 的 React effect 加载首屏 Workspace/Project 数据。Remote mount 成功后由插件生命周期主动调用共享的 Project list loader，Settings 和 overlay 共同消费同一份状态。

dsh `shell.overlay` is an independent Client Slot and must not depend on the `settings.section` React effect to load first-screen Workspace/Project data. After the Remote mounts, the plugin lifecycle proactively calls the shared Project-list loader, while Settings and the overlay consume the same state.

首屏现在明确表达 Remote `loading`、请求 `loading`、`error`、`unmounted/idle` 和 `missing` 状态；禁止 `idle + empty`。Remote mount 和首次 list request 都有 10 秒超时，失败显示脱敏诊断及重试或连接入口。

The first screen now explicitly represents Remote `loading`, request `loading`, `error`, `unmounted/idle`, and `missing` states; `idle + empty` is forbidden. Both the Remote mount and the first list request have a 10-second timeout, and failures expose redacted diagnostics with a retry or connect entry.

## 验证 / Verification

- `node --test test/client-contract.test.mjs`: `5/5 passed`。
- `node --check client/plugin-client.js` and `node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: passed.
- 两份 Client bundle 内容比较：passed；`git diff --check`: passed。
- 真实 dsh Web 验收：点击 `+ Xiaobai` 后显示 `missing`、Workspace 选择提示和 `Choose Workspace directory`，不再显示空白 `idle`。
- 完整插件测试：`66/68`；`apply.test.mjs` 的 Host version matrix mock 和 `plugin.test.mjs` 的 M0 probe seam-version mismatch 仍失败，不能报告为全量通过。
- 本轮没有重新执行根 `npm run validate` 或根 `npm test`。

- `node --test test/client-contract.test.mjs`: `5/5 passed`.
- `node --check client/plugin-client.js` and `node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: passed.
- Equality comparison of both Client bundles: passed; `git diff --check`: passed.
- Real dsh Web acceptance: clicking `+ Xiaobai` shows `missing`, the Workspace-selection prompt, and `Choose Workspace directory`; the blank `idle` view is gone.
- Full plugin suite: `66/68`; `apply.test.mjs` still fails because its Host version matrix mock is incomplete, and `plugin.test.mjs` still fails because the M0 probe exits on the seam-version mismatch; the suite must not be reported as fully passed.
- Root `npm run validate` and root `npm test` were not rerun in this round.

## 可复用规则 / Reusable Rule

任何新增 dsh Client Slot 时，先列出该 Slot 的独立首屏数据依赖和 lifecycle，再为 loading、error、missing、empty、retry 设计可见结果；不要把加载副作用放在另一个页面组件中。Contract test 必须独立渲染 overlay，并验证 mount 失败、超时和成功后的首次 list 行为。

Whenever a new dsh Client Slot is added, list that Slot's independent first-screen data dependencies and lifecycle first, then define visible loading, error, missing, empty, and retry outcomes. Do not put the loading side effect in another page component. Contract tests must render the overlay independently and verify mount failure, timeout, and first-list behavior after success.
