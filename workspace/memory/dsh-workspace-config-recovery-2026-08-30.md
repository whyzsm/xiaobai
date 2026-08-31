# dsh 工作区配置恢复验证 / dsh Workspace Configuration Recovery Verification

## 结论 / Outcome

截图中的“配置无效”来自旧的未选择工作区状态，不是当前 ProjectGroup 配置解析失败。确认 `workspace` 目录后，dsh UI 显示“已加载”，并展示项目列表与逐项诊断。

The screenshot's "Invalid configuration" state came from the old unselected-workspace state, not from a current ProjectGroup parsing failure. After confirming the `workspace` directory, the dsh UI shows "Loaded" and renders the project list with itemized diagnostics.

## 可复用规则 / Reusable Rule

工作区首次加载必须经过“选择目录”入口；选择成功后，关闭并重新打开工作区面板、刷新 dsh 页面，都应恢复已加载状态。旧版 `kind: Project` 配置应作为兼容告警跳过，不得阻断其他有效 ProjectGroup。

The first Workspace load must go through the directory-selection entry point. After a successful selection, closing and reopening the Workspace panel and refreshing dsh must restore the loaded state. A legacy `kind: Project` configuration must be skipped as a compatibility warning and must not block other valid ProjectGroups.

## 真实诊断 / Observed Diagnostics

本机当前的 4 条提示分别是：`app-a` 为旧版配置；T-MAX 的 `emt` 仓库挂载不存在；T-MAX 背景知识挂载可用；`trunkFeeder-ui` 仓库和背景知识挂载未配置，因此对应项目显示为 unavailable。目录不存在属于本机挂载配置问题，不应渲染为全局“配置无效”。

The four local diagnostics are: `app-a` uses the legacy configuration; the T-MAX `emt` repository mount is absent; the T-MAX background knowledge mount is available; and the `trunkFeeder-ui` repository and background mounts are not configured, so that project is shown as unavailable. Missing local directories are machine-local mount configuration issues and must not render as a global "Invalid configuration" state.

## 执行证据 / Execution Evidence

- 浏览器确认工作区目录后显示“已加载”、3 个项目和 4 条诊断；关闭、重新打开及刷新后结果保持一致，控制台无 warning/error。
- `node --test test/client-contract.test.mjs`：6/6 passed。
- `node --check client/plugin-client.js`、`node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`：通过。
- `git diff --check`：通过。

- Browser verification after confirming the Workspace directory showed "Loaded", 3 Projects, and 4 diagnostics; the same result remained after close/reopen and refresh, with no console warnings or errors.
- `node --test test/client-contract.test.mjs`: 6/6 passed.
- `node --check client/plugin-client.js` and `node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: passed.
- `git diff --check`: passed.
