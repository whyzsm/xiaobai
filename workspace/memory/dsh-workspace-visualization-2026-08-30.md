# dsh 工作区配置与 @项目入口收口 / dsh Workspace Configuration And @project Entry Closure

## 结论 / Conclusion

本轮完成 dsh 工作区配置恢复、只读可视化和 `@项目` 简化入口的实现收口。一个 dsh Host Workspace 继续作为唯一运行宿主；多个 Project 以显式 `Project scope` 隔离，Project 的代码、Knowledge、Skill、Agent policy、Memory namespace、Loop 和证据不会通过 cwd 或全局 current project 隐式混用。

This round closed the implementation of dsh Workspace configuration recovery, read-only visualization, and the simplified `@project` entry. One dsh Host Workspace remains the only runtime host; multiple Projects are isolated through explicit Project scopes, and Project code, Knowledge, Skills, Agent policies, Memory namespaces, Loops, and evidence are never implicitly mixed through cwd or a global current Project.

## @项目 生命周期 / @project Lifecycle

`@项目` 通过 dsh 原生 Input Trigger 注册为 `xiaobai-project`。候选项来自当前 Host Workspace 中已加载且 Knowledge/Repository lock 就绪的 Project；候选、插入值和序列化引用只携带 opaque `workspaceId`、`projectId` 和显示标签，不暴露本机绝对路径、URL、凭证或背景正文。

`@project` is registered as `xiaobai-project` through the native dsh Input Trigger. Candidates come from Projects already loaded in the current Host Workspace with ready Knowledge and Repository locks; candidates, inserted values, and serialized references carry only opaque `workspaceId`, `projectId`, and display labels, exposing no machine-absolute paths, URLs, credentials, or background body content.

生命周期顺序固定为 `agent/inbox/claimed -> systemPrompt.assemble -> agent/pre-step -> agent/disposed`：claimed 阶段同步创建 Agent-owned Project scope 并注册 system prompt context，保证首轮 assemble 已包含项目上下文；pre-step 是最终门禁，负责等待旧 Project close、拒绝跨 Workspace/跨 Project 混用和未锁定绑定、清理 Project markup；disposed 释放 prompt disposer、scope 和 registry 资源。

The lifecycle order is fixed as `agent/inbox/claimed -> systemPrompt.assemble -> agent/pre-step -> agent/disposed`: `claimed` synchronously creates the Agent-owned Project scope and registers the system-prompt context so the first assemble includes the Project context; `pre-step` is the final gate that waits for the previous Project close, rejects cross-Workspace/cross-Project mixing and unlocked bindings, and removes Project markup; `disposed` releases the prompt disposer, scope, and registry resources.

## Client 入口 / Client Entry

插件 Client 只保留 dsh Settings 中的 `settings.section`，稳定 contribution id 为 `xiaobai-workspace`，可见产品名称统一为“小白”。Remote mount、Workspace/Project list request 均有界等待并提供可见错误和重试；原生 Directory Picker 优先于兼容 browse 路径。

The plugin Client keeps only the dsh Settings `settings.section` contribution with stable contribution id `xiaobai-workspace`, and the visible product name is consistently “小白”. Remote mounting and Workspace/Project list requests have bounded waits with visible errors and retry actions; the native Directory Picker takes precedence over the compatibility browse path.

## 验证证据 / Verification Evidence

- 插件全量：`npm test`，`86/86 passed`。
- Plugin full suite: `npm test`, `86/86 passed`.

- 根校验：`npm run validate`，4 个 Loop 全部 `OK`。
- Root validation: `npm run validate`, all four Loops returned `OK`.

- 根测试：`npm test`，`151/151 passed`。
- Root tests: `npm test`, `151/151 passed`.

- `node --test test/apply.test.mjs test/plugin.test.mjs`，`19/19 passed`；mock Host 使用显式 `hostVersionOptions` 隔离本机旧 dsh manifest，生产路径仍默认对真实版本 mismatch fail-closed。
- `node --test test/apply.test.mjs test/plugin.test.mjs`, `19/19 passed`; mock Hosts use explicit `hostVersionOptions` to isolate local old dsh manifests, while the production path still fails closed on real version mismatches by default.

- Client/架构聚焦测试：`12/12 passed`；native picker 聚焦测试：`21/21 passed`；`git diff --check`、Client bundle syntax check 和 bundle equality check 通过。
- Client/architecture focused tests: `12/12 passed`; native-picker focused tests: `21/21 passed`; `git diff --check`, Client bundle syntax checks, and bundle equality checks passed.

- 真实 dsh Web 验收确认设置页不再是空白 `idle`，能显示 Workspace 缺失诊断和选择入口；原生目录选择请求进入 macOS `choose folder`。
- Real dsh Web acceptance confirmed that the Settings view no longer renders a blank `idle` state and shows the missing-Workspace diagnostic and selection entry; native directory selection reached macOS `choose folder`.

## 环境注意 / Environment Note

当前插件目录下的本机 `node_modules` 仍可能链接 dsh `0.1.0-rc.6` seam 包；这不应被当作已升级的 dsh 运行时。插件合同、peer dependency、manifest 和真实 Web 验收目标为 dsh `0.1.1-rc.2`；生产版本探针保持严格拒绝旧版行为。外部 dsh 仓库和本机挂载不属于本工程提交边界。

The local plugin `node_modules` may still link dsh `0.1.0-rc.6` seam packages; this must not be treated as an upgraded dsh runtime. The plugin contract, peer dependencies, manifest, and real Web acceptance target dsh `0.1.1-rc.2`; the production version probe continues to reject old versions strictly. External dsh repositories and machine-local mounts remain outside this repository's commit boundary.
