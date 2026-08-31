# dsh 系统原生目录选择器 / dsh Native System Directory Picker

## 结论 / Outcome

工作区配置的目录入口应直接调用 dsh Host 的系统原生 Directory Picker。生产 bundle 同时固定 `@deepseek-ai/dsh-host-directory-picker-native` 与 `@deepseek-ai/dsh-client-ui-directory-picker-native`，Client 优先通过 typed Remote 调用 `workspaces.pickDirectory`，不要求用户在网页目录树中逐级浏览。

Workspace configuration directory entry points should call the dsh Host native Directory Picker directly. The production bundle pins both `@deepseek-ai/dsh-host-directory-picker-native` and `@deepseek-ai/dsh-client-ui-directory-picker-native`; the Client prefers the typed Remote `workspaces.pickDirectory`, so users do not need to browse a Web directory tree.

## Host 合同 / Host Contract

插件从 Cordis 注入的 `directoryPicker` 读取 `capability()`，并调用官方 `capability.pick(signal)`。不能调用不存在的 `picker.pick()`，也不能让 Client 直接访问文件系统。Host 对返回目录执行 `realpath`、目录类型和边界校验，向 Client 只返回 opaque `bindingRef`、相对 locator、digest 和状态。

The plugin reads `capability()` from the Cordis-injected `directoryPicker` and calls the official `capability.pick(signal)`. It must not call the nonexistent `picker.pick()` or let the Client access the filesystem directly. The Host applies `realpath`, directory-type, and boundary validation, and returns only an opaque `bindingRef`, a relative locator, a digest, and status to the Client.

`browse` capability 只作为显式兼容路径：必须由用户确认路径，不能被静默当作 native。native 能力缺失时返回稳定的 Host unsupported 诊断，不能猜测 Workspace root 或使用隐式 cwd。

The `browse` capability is an explicit compatibility path only: the user must confirm the path, and it cannot be silently treated as native. When native capability is unavailable, return a stable Host-unsupported diagnostic; do not guess the Workspace root or use an implicit cwd.

## 执行证据 / Execution Evidence

- 真实 dsh `0.1.1-rc.2` Remote 验收触发 macOS：`osascript -e set selectedFolder to choose folder with prompt "Select Workspace Directory"`。
- 该证据表明请求进入系统目录选择器，而不是网页目录浏览器；测试启动的 `osascript` 已按明确 PID 清理，无残留进程。
- 聚焦测试：`node --test test/config-console.test.mjs test/architecture.test.mjs test/client-contract.test.mjs`，结果 `21/21 passed`。
- 本轮未重新执行受保护的根 `npm run validate` 和根 `npm test`；完整插件测试已知为 `66/68`，两个失败与 Host version matrix mock 和 M0 seam-version mismatch 有关。

- Real dsh `0.1.1-rc.2` Remote acceptance triggered macOS with `osascript -e set selectedFolder to choose folder with prompt "Select Workspace Directory"`.
- This proves that the request entered the system directory picker rather than the Web directory browser; the test-launched `osascript` process was cleaned up by explicit PID with no residual process.
- Focused tests: `node --test test/config-console.test.mjs test/architecture.test.mjs test/client-contract.test.mjs`, result `21/21 passed`.
- The protected root `npm run validate` and `npm test` commands were not rerun in this round; the known full plugin result is `66/68`, with the two failures related to the Host version matrix mock and the M0 seam-version mismatch.

## 持久规则 / Durable Rule

新增 dsh Client Slot 时，必须验证独立入口的首屏数据依赖；目录选择入口必须在 native、browse、cancel、unsupported 和路径校验失败状态下都有可见结果。任何本机绝对路径不得进入 Remote envelope、Storage、Dashboard 或 Memory 日志。

When adding a dsh Client Slot, verify the first-screen data dependencies of the independent entry point. Directory-selection entry points must have visible outcomes for native, browse, cancel, unsupported, and path-validation failure states. Machine-absolute paths must never enter the Remote envelope, Storage, Dashboard, or Memory logs.
