# dsh Web 冒烟测试 / dsh Web Smoke Test

## 结论 / Outcome

本轮已在 Node `v24.19.0` 下启动 dsh `0.1.0-rc.6` 的 `web` profile，插件 `@xiaobai/dsh-plugin` 已加载，页面与 Workspace 配置入口通过真实浏览器冒烟测试。

This round started the dsh `0.1.0-rc.6` `web` profile under Node `v24.19.0`. The `@xiaobai/dsh-plugin` loaded successfully, and the page plus the Workspace configuration entry passed a real-browser smoke test.

## 启动修复 / Startup Fix

启动首次失败的根因是本机 `~/.dsh/.credentials.yaml` 仍使用旧的 `version/refs` 包装格式，而 rc.6 凭据解析器要求顶层 credential-reference-to-string 映射。已在本机配置中仅迁移结构，保留凭据值；没有把凭据写入工程仓库或测试输出。

The first startup failed because the machine-local `~/.dsh/.credentials.yaml` still used the old `version/refs` wrapper, while the rc.6 credential parser requires a top-level credential-reference-to-string mapping. The local structure was migrated while preserving credential values; no credentials were written to this repository or test output.

## 执行证据 / Execution Evidence

- `./node_modules/.bin/dsh --version` 返回 `0.1.0-rc.6`。
- `./node_modules/.bin/dsh --profile web --dump-config` 成功解析 `xiaobai-invariants` 与 `@xiaobai/dsh-plugin` bundle。
- `./node_modules/.bin/dsh web` 在 Node `v24.19.0` 下成功启动，服务地址为 `http://127.0.0.1:3080/`。
- 浏览器页面标题为 `DeepSeek Harness`，`+ Xiaobai` 入口数量为 `1` 且可见。
- 点击入口后，`Xiaobai Workspace` dialog 数量为 `1` 且可见；干净重载后再次打开并关闭，关闭后的 dialog 数量为 `0`。
- 最终浏览器 error/warning 日志为 `[]`，dsh 服务进程仍在运行。

- `./node_modules/.bin/dsh --version` returned `0.1.0-rc.6`.
- `./node_modules/.bin/dsh --profile web --dump-config` successfully resolved the `xiaobai-invariants` and `@xiaobai/dsh-plugin` bundles.
- `./node_modules/.bin/dsh web` started successfully under Node `v24.19.0` at `http://127.0.0.1:3080/`.
- The browser page title was `DeepSeek Harness`, and exactly one visible `+ Xiaobai` entry was found.
- After clicking the entry, the `Xiaobai Workspace` dialog had count `1` and was visible; after a clean reload, opening and closing it again left the dialog count at `0`.
- The final browser error/warning log was `[]`, and the dsh server process remains running.

## 可复用规则 / Reusable Rule

每次更新 dsh 依赖、profile、插件 link 或凭据格式后，都要使用匹配的 Node 版本重启 dsh，并对新页面执行一次干净加载；同时检查插件入口、主要 overlay 交互和浏览器 error/warning，而不能只依据服务端启动日志。

After changing dsh dependencies, the profile, a plugin link, or the credential format, restart dsh with the matching Node version and perform a clean page load. Check the plugin entry, the main overlay interaction, and browser errors/warnings instead of relying only on server startup logs.
