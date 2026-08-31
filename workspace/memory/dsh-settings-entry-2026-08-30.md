# dsh 小白设置入口收敛 / dsh Xiaobai Settings-Only Entry

## 结论 / Decision

小白插件只通过 dsh 的 `settings.section` 提供用户入口；移除 `sidebar.footer.action` 外部快捷入口和只服务于该入口的 `shell.overlay` contribution。设置导航 label、配置页标题、ARIA label 与连接错误提示统一使用“小白”。

The Xiaobai plugin exposes its user entry only through dsh `settings.section`; the external `sidebar.footer.action` shortcut and the `shell.overlay` contribution used only by that shortcut are removed. The Settings label, configuration title, ARIA label, and connection-error copy consistently use “小白”.

内部 Remote namespace、Host service key、稳定 contribution id `xiaobai-workspace` 以及 Workspace/Project 领域术语保持不变。系统原生目录选择器仍由 Host `capability().pick()` 提供，不受入口收敛影响。

The internal Remote namespace, Host service key, stable contribution id `xiaobai-workspace`, and Workspace/Project domain terms remain unchanged. The native system directory picker remains provided by the Host through `capability().pick()` and is unaffected by the entry-surface change.

## Evidence / 执行证据

- `node --test test/client-contract.test.mjs test/architecture.test.mjs`: `12/12 passed`。
- `npm run evaluate:config`: evaluator `agent_xiaobai_config_eval`, status `passed`, findings `AC-01` through `AC-10` all passed。
- `node --check client/plugin-client.js` and `node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: passed。
- `cmp -s client/plugin-client.js loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: bundle equality passed。
- `git diff --check`: passed。
- dsh browser acceptance: the sidebar had no external `+ 小白`; Settings contained `小白`; entering it rendered region/title `小白` and the `选择工作区目录` action。

- `node --test test/client-contract.test.mjs test/architecture.test.mjs`: `12/12 passed`.
- `npm run evaluate:config`: evaluator `agent_xiaobai_config_eval` returned `passed`, with all findings `AC-01` through `AC-10` passed.
- `node --check client/plugin-client.js` and `node --check loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: passed.
- `cmp -s client/plugin-client.js loop-engineering/packages/xiaobai-dsh-plugin/lib/client.js`: bundle equality passed.
- `git diff --check`: passed.
- dsh browser acceptance: the sidebar had no external `+ 小白`; Settings contained `小白`; entering it rendered the region/title `小白` and the `选择工作区目录` action.

## Remaining Gates / 剩余门禁

本轮没有重新执行根 `npm run validate` 或根 `npm test`；任务继续保持 Trellis `in_progress`。此前完整插件测试记录仍为 `66/68`，其中两个失败分别与旧 Host version matrix mock 和 M0 seam-version mismatch 有关，不能写成全量通过。

The root `npm run validate` and `npm test` commands were not rerun in this round; the Trellis task remains `in_progress`. The previous full plugin-suite record remains `66/68`, with two failures related to the outdated Host version matrix mock and the M0 seam-version mismatch; it must not be reported as fully passing.
