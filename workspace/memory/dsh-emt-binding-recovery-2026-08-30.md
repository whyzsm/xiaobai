# DSH `t-max` emt 绑定修复 / DSH `t-max` emt Binding Recovery

## 结论 / Outcome

本机 `t-max` 项目因 `emt` 仓库没有本地路径绑定，导致 `@t-max` 选择后提交失败，并在运行结果区域表现为空白。已将 `emt` 绑定到真实仓库 `/Users/seminzhu/Documents/ane/code/git/emtui`，并通过现有挂载脚本恢复统一挂载。

The local `t-max` project failed after selecting `@t-max` because the `emt` repository had no local path binding, leaving the run result area visually blank. The binding now points to the real repository at `/Users/seminzhu/Documents/ane/code/git/emtui`, and the shared mount has been restored with the existing mount script.

## 验证 / Verification

- `npm run mount:tmax` exited with code `0` and created `workspace/.local/t-max/mounts/repos/emt`.
- `loadWorkspaceConfig('./workspace')` reported all 8 `t-max` repository statuses as `locked`.
- DSH browser verification showed `@t-max` as `知识已锁定 · 仓库已锁定`; selecting it rendered `当前项目：t-max` and the project chip.

- `npm run mount:tmax` exited with code `0` and created `workspace/.local/t-max/mounts/repos/emt`.
- `loadWorkspaceConfig('./workspace')` reported all 8 `t-max` repository statuses as `locked`.
- DSH browser verification showed `@t-max` as `知识已锁定 · 仓库已锁定`; selecting it rendered `当前项目：t-max` and the project chip.

## 可复用规则 / Reusable Rule

项目组声明的每个仓库都必须同时具备真实本机路径和统一挂载；任一仓库不可用时，项目引用应在提交前明确阻断并显示可操作原因，不能让运行结果区域退化为空白。

Every repository declared by a project group must have both a real local path and a shared mount. When any repository is unavailable, project reference submission should fail before execution with an actionable reason instead of degrading the run result area to a blank state.
