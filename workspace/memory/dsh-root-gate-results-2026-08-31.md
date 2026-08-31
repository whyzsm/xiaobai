# dsh 插件项目根门禁结果 / dsh Plugin Root Gate Results

## 中文

2026-08-31 对 dsh 项目上下文恢复与切换插件修改执行了用户确认的根级门禁。`npm run validate` 未通过：当前 `t-max` 项目配置声明了 `ane-standard-page` skill package loop，但本机挂载的 `<xiaoneng-local-checkout>`（`xiaoneng5.0`，工作区干净）没有 `xiaobai/loops/ane-standard-page.loop.yaml` 及相应 package agent 文件，因此校验按 fail-closed 规则拒绝。

`npm test` 的 TypeScript 构建通过，但当前外部挂载存在时结果为 `101/151 passed`、`50 failed`。失败主要由同一个缺失 package loop 声明连锁触发，另有页面契约源 digest `4abd0472a4bd3315c2240de77e5a08c7430b7f2dee741df97dc7317b7d81014d` 与仓库快照锁定值 `21ffe82ad6762ba8321b9eaa37e02dedd657870d7b9a68d885a72ed570f3ab07` 不一致。

为区分仓库问题和本机外部挂载问题，临时移出并自动恢复被 git 忽略的 xiaoneng 软链接后复测：`npm run validate` 仍因 `ane-standard-page` 声明的 package agent 无挂载而失败；`npm test` 改为 `143/151 passed`、`7 failed`、`1 skipped`，7 个失败全部是同一组 `ane-standard-page` package agent/loop 资产不可用。外部软链接已恢复到原路径，外部仓未修改。

本次插件专属测试 `node --test loop-engineering/packages/xiaobai-dsh-plugin/test/*.test.mjs` 通过 `88/88`；客户端语法检查、bundle 一致性和 `git diff --check` 通过。根门禁失败不由本次三个插件文件的改动引起，后续需要先决定是把 `t-max` project asset 声明同步到当前 xiaoneng package 布局，还是恢复匹配声明的 xiaoneng 版本；页面契约 digest 也需要明确是否重新 pin，不能静默更新。

## English

On 2026-08-31, the user-confirmed root gates were run for the dsh project-context recovery and switching plugin change. `npm run validate` failed because the current `t-max` project configuration declares the `ane-standard-page` skill-package loop, while the clean local `xiaoneng5.0` checkout at `<xiaoneng-local-checkout>` does not contain `xiaobai/loops/ane-standard-page.loop.yaml` or the corresponding package-agent files. Validation correctly rejected this through the fail-closed path.

The TypeScript build inside `npm test` passed, but with the external mount present the suite ended at `101/151 passed` and `50 failed`. The failures were primarily cascaded from the same missing package-loop declaration; an additional failure reported that the mounted page-contract source digest `4abd0472a4bd3315c2240de77e5a08c7430b7f2dee741df97dc7317b7d81014d` differs from the repository-pinned snapshot value `21ffe82ad6762ba8321b9eaa37e02dedd657870d7b9a68d885a72ed570f3ab07`.

To separate repository behavior from local external-mount drift, the git-ignored xiaoneng symlink was temporarily moved out of the test path and automatically restored. In that isolated run, `npm run validate` still failed because declared `ane-standard-page` package agents had no mount; `npm test` improved to `143/151 passed`, `7 failed`, and `1 skipped`, with all seven failures belonging to the unavailable `ane-standard-page` package loop/agent assets. The external symlink was restored and the external repository was not modified.

The plugin-focused suite `node --test loop-engineering/packages/xiaobai-dsh-plugin/test/*.test.mjs` passed `88/88`; client syntax checks, bundle equality, and `git diff --check` passed. The root-gate failures are not caused by the three changed plugin files. The next step requires an explicit choice: either synchronize the `t-max` project asset declarations with the current xiaoneng package layout or restore an xiaoneng version matching those declarations; the page-contract digest must also be deliberately re-pinned or left locked, never silently updated.
