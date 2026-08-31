# dsh Loop package 对齐修复 / dsh Loop Package Alignment Fix

## 中文

2026-08-31，修复 t-max 项目配置与当前 xiaoneng package 布局不一致的问题。当前工程仓仅提供 `ane-standard-page`、`frontend-delivery` 和 `morning-triage` 三个 Loop；项目配置中已删除不存在的 `tmax-coding` discovery skill 与 loop-scoped evidence bundle 映射，也没有恢复不存在的外部 package asset 声明。

回归测试改为验证真实存在的 Loop：`ane-standard-page` 使用专属证据覆盖，`frontend-delivery` 使用组级证据回退并解析为 `FullWorkflow`。测试使用临时 workspace，避免依赖或修改真实运行空间。

页面契约 parity 夹具已同步当前挂载 xiaoneng 源的提交和摘要；外部 xiaoneng 仓库未修改。

验证证据：`npm run validate` 的三个 Loop 均为 `OK`；`npm test` 为 `151/151 passed`；`git diff --check` 通过。首次尝试直接用 `node --test --import tsx` 不是仓库定义的测试入口，因环境没有 `tsx` 失败，随后使用仓库定义的 `npm test` 成功完成验证。

## English

On 2026-08-31, the t-max project configuration was aligned with the current xiaoneng package layout. The engineering workspace currently provides only `ane-standard-page`, `frontend-delivery`, and `morning-triage`; the project configuration now removes the nonexistent `tmax-coding` discovery skill and loop-scoped evidence-bundle mapping, and does not restore nonexistent external package asset declarations.

The regression test now covers real loops: `ane-standard-page` uses loop-scoped evidence, while `frontend-delivery` uses the group-level fallback and resolves to `FullWorkflow`. The test uses a temporary workspace so it does not depend on or modify the real operating workspace.

The page-contract parity fixture was synchronized with the current mounted xiaoneng source commit and digests; the external xiaoneng repository was not modified.

Evidence: all three loops returned `OK` from `npm run validate`; `npm test` completed with `151/151 passed`; and `git diff --check` passed. A first direct `node --test --import tsx` attempt was not the repository-defined test entry and failed because `tsx` is unavailable; the repository-defined `npm test` then completed successfully.
