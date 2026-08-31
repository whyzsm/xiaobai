# dsh 插件安装记录 / dsh Plugin Installation Record

## 结论 / Outcome

已将本地 `@xiaobai/dsh-plugin` 安装到 dsh `web` profile。插件以本地 link 方式注册，profile 的 `dsh.profile.bundles` 已包含 `@xiaobai/dsh-plugin`。

The local `@xiaobai/dsh-plugin` has been installed into the dsh `web` profile. The plugin is registered as a local link, and the profile `dsh.profile.bundles` now includes `@xiaobai/dsh-plugin`.

## 安装来源与环境 / Source And Environment

- 插件来源 / Source: `<repo-root>/loop-engineering/packages/xiaobai-dsh-plugin`
- 插件版本 / Plugin version: `0.1.0`
- dsh host: `0.1.0-rc.6`
- 目标 profile / Target profile: `~/.dsh/profiles/web`
- 包管理器 / Package manager: pnpm `11.22.0`

## 验证证据 / Verification Evidence

- `dsh plugin --profile web add <local-path>` returned exit code `0`.
- Profile manifest contains `@xiaobai/dsh-plugin: link:<repo-root>/loop-engineering/packages/xiaobai-dsh-plugin`.
- The profile node module resolves to the plugin `lib/index.js`.
- `dsh --profile web --dump-config` returned exit code `0` and composed `xiaobai-invariants` plus `xiaobai-dsh` layers.
- The dsh command must use a pnpm executable that is not intercepted by Corepack's parent Yarn `packageManager` setting.

- `dsh plugin --profile web add <local-path>` returned exit code `0`.
- The profile manifest contains `@xiaobai/dsh-plugin: link:<repo-root>/loop-engineering/packages/xiaobai-dsh-plugin`.
- The profile node module resolves to the plugin `lib/index.js`.
- `dsh --profile web --dump-config` returned exit code `0` and composed the `xiaobai-invariants` and `xiaobai-dsh` layers.
- The dsh command must use a pnpm executable that is not intercepted by Corepack's parent Yarn `packageManager` setting.

## 后续 / Follow-up

重启 dsh web profile 后即可使用新 bundle。工程仓只保留本记录和插件源码；`~/.dsh` 下的 profile manifest、lockfile 和 link 属于本机状态。

Restart the dsh web profile to use the new bundle. The engineering repository keeps only this record and the plugin source; the profile manifest, lockfile, and link under `~/.dsh` are machine-local state.

## 启动诊断 / Startup Diagnosis

`deepseekHarness` 当前实际使用 `@deepseek-ai/dsh@0.1.1-rc.2` 及对应 seam packages，而插件支持矩阵固定为 `0.1.0-rc.6`。插件启动时因此正确返回 `XIAOBAI_HOST_UNSUPPORTED`；不能通过删除版本探测来绕过该门禁。使用 `.dsh/dsh-browser` 的 rc.6 入口后，版本门禁不再报错，但该入口随后暴露了独立的 `~/.dsh/.credentials.yaml` 格式问题（`version: 1` 的类型与 rc.6 凭据解析器不匹配），凭据文件没有被自动修改。

`deepseekHarness` currently uses `@deepseek-ai/dsh@0.1.1-rc.2` and matching seam packages, while the plugin support matrix is pinned to `0.1.0-rc.6`. The plugin therefore correctly returns `XIAOBAI_HOST_UNSUPPORTED` at startup; deleting version probing is not a valid workaround. When the `.dsh/dsh-browser` rc.6 entrypoint is used, the version gate no longer fails, but that entrypoint then exposes a separate `~/.dsh/.credentials.yaml` format issue (`version: 1` has the wrong type for the rc.6 credential parser); the credentials file was not modified automatically.

## 宿主整体升级 / Host Upgrade

`deepseekHarness/package.json` 的 5 个 dsh 直接依赖已更新为 `0.1.0-rc.6`，并使用 `npm install --before 2026-08-17T00:00:00Z --ignore-scripts` 重建 `package-lock.json` 与 `node_modules`。锁文件中的 186 个 `@deepseek-ai/dsh*` 包均为 `0.1.0-rc.6`；在 Node `v22.22.1` 下，插件 `probeHostVersions()` 返回 `verified`，dsh 配置 dump 也成功组合 xiaobai bundle。

The five direct dsh dependencies in `deepseekHarness/package.json` were updated to `0.1.0-rc.6`, and `npm install --before 2026-08-17T00:00:00Z --ignore-scripts` rebuilt `package-lock.json` and `node_modules`. All 186 `@deepseek-ai/dsh*` packages in the lockfile are `0.1.0-rc.6`; under Node `v22.22.1`, the plugin `probeHostVersions()` returned `verified`, and the dsh config dump composed the xiaobai bundle successfully.

当前启动仍需迁移旧 rc.2 凭据布局：`~/.dsh/.credentials.yaml` 目前是 `{version: 1, refs: {...}}`，rc.6 要求直接的 credential-to-string mapping。迁移会改写本机密钥文件，必须单独获得确认；升级过程未修改该文件。

Startup still requires migrating the old rc.2 credential layout: `~/.dsh/.credentials.yaml` is currently `{version: 1, refs: {...}}`, while rc.6 requires a direct credential-to-string mapping. Migration would rewrite the machine-local secret file and requires separate confirmation; the upgrade did not modify this file.

## rc.6 凭据迁移与 Node 24 启动验证 / rc.6 Credential Migration And Node 24 Startup Verification

已在用户确认后备份 `~/.dsh/.credentials.yaml` 到 `/tmp/dsh-credentials.yaml.before-rc6-20260830`，并使用 YAML 解析将 `refs` 中的 3 个字符串凭据提升到顶层；当前凭据文件与备份权限均为 `0600`，密钥值未输出到终端。该备份位于本机临时目录，不属于工程仓提交边界。

After user confirmation, `~/.dsh/.credentials.yaml` was backed up to `/tmp/dsh-credentials.yaml.before-rc6-20260830`. A YAML parser promoted the three string credentials from `refs` to the top level; both the live file and backup have `0600` permissions, and no secret values were printed. The backup is machine-local temporary state outside the engineering repository commit boundary.

已通过 `fnm use 24` 确认 Node `v24.19.0` 与 npm `11.17.0`，并在该 Node 版本下串行启动 `deepseekHarness`：插件输出显示中文提示已就绪、配置客户端已暴露提示词注入设置、`web` profile 热装卸监督器已启动，服务地址为 `http://127.0.0.1:56232`。HTTP 根页面返回 `200 OK`，启动清单包含 dsh boot manifest 和 `deepseek-harness-zh_pro` 插件。

`fnm use 24` confirmed Node `v24.19.0` and npm `11.17.0`. `deepseekHarness` then started serially under that Node version: plugin output confirmed the Chinese prompt was ready, prompt-injection settings were exposed to the configuration client, and the `web` profile hot-load supervisor started. The service URL was `http://127.0.0.1:56232`. The HTTP root returned `200 OK`, and the boot manifest included dsh boot metadata and the `deepseek-harness-zh_pro` plugin.

## Web Boot 修复与当前版本校正 / Web Boot Recovery And Current Version Correction

后续实际状态以 `deepseekHarness` 当前文件为准：宿主及相关 dsh 包是 `0.1.1-rc.2`，`@xiaobai/dsh-plugin` 自身仍是 `0.1.0`，插件通过 profile 本地 link 使用；此前 rc.6 记录属于先前状态，不能作为当前版本结论。

The later actual state is determined by the current `deepseekHarness` files: the host and related dsh packages are `0.1.1-rc.2`, `@xiaobai/dsh-plugin` itself remains `0.1.0`, and the plugin is used through a local profile link. The earlier rc.6 record describes a previous state and must not be used as the current version conclusion.

浏览器报错 `web boot: window.__ModuleLoader__ bootstrap facade is missing` 的原因是依赖重装后仍有旧 dsh 进程运行，旧进程内存中的 Host/boot 注入与磁盘上的 rc.2 前端资源不一致。停止旧 PID `24725` 并用 Node `v24.19.0` 重启后，服务地址为 `http://127.0.0.1:64617`；响应包含 `window.__ModuleLoader__` queue、`@deepseek-ai/dsh-client-modules/client.js` preload、`@deepseek-ai/dsh-client-runtime/client.js` preload 和 `__DSH_BOOT__`。浏览器新加载后按 URL 过滤的错误日志为空，根节点正常显示应用内容。

The browser error `web boot: window.__ModuleLoader__ bootstrap facade is missing` was caused by an old dsh process remaining alive after dependency reinstall, so its in-memory Host/boot injection did not match the rc.2 frontend files on disk. After stopping PID `24725` and restarting with Node `v24.19.0`, the service runs at `http://127.0.0.1:64617`; the response contains the `window.__ModuleLoader__` queue, the `@deepseek-ai/dsh-client-modules/client.js` preload, the `@deepseek-ai/dsh-client-runtime/client.js` preload, and `__DSH_BOOT__`. After a fresh browser load, URL-filtered error logs were empty and the root rendered application content normally.

规则：每次修改 `deepseekHarness` 的 dsh 依赖、profile 或凭据后，必须停止旧 dsh 进程并重新启动，再用浏览器新加载验证；不能仅依赖 HTTP `200 OK`，还要检查 boot queue/preload 和浏览器 console。

Rule: after changing `deepseekHarness` dsh dependencies, profile, or credentials, stop the old dsh process and restart it before verifying with a fresh browser load. Do not rely on HTTP `200 OK` alone; also check the boot queue/preloads and browser console.

## 本次 dsh web profile 更新 / Current dsh Web Profile Update

已在 dsh `0.1.0-rc.6` 的 `web` profile 重新注册本地 `@xiaobai/dsh-plugin` link。使用 Node `v24.19.0` 和独立 pnpm `11.22.0` 执行 `dsh plugin --profile web add "@xiaobai/dsh-plugin@link:<repo-root>/loop-engineering/packages/xiaobai-dsh-plugin"`，命令返回 `Already up to date` 并成功完成。

The local `@xiaobai/dsh-plugin` link was re-registered in the dsh `0.1.0-rc.6` `web` profile. The update used Node `v24.19.0` and standalone pnpm `11.22.0` with `dsh plugin --profile web add "@xiaobai/dsh-plugin@link:<repo-root>/loop-engineering/packages/xiaobai-dsh-plugin"`; it returned `Already up to date` and completed successfully.

验证证据：profile `package.json` 和 `pnpm-lock.yaml` 均指向该本地 link，`dsh.profile.bundles` 包含 `@xiaobai/dsh-plugin`，`dsh plugin --profile web why @xiaobai/dsh-plugin` 返回本地源码目录，`dsh --profile web --dump-config` 成功解析该 bundle；link 下的 `index.js`、Client bundle、`config-console.js` 和 `typert.js` 语法检查通过。当前没有运行中的 dsh 进程，因此没有强制终止用户进程；下次启动 `web` profile 时加载此更新。

Evidence: the profile `package.json` and `pnpm-lock.yaml` both point to the local link, `dsh.profile.bundles` includes `@xiaobai/dsh-plugin`, `dsh plugin --profile web why @xiaobai/dsh-plugin` resolves to the local source directory, and `dsh --profile web --dump-config` successfully resolves the bundle. Syntax checks passed for the linked `index.js`, Client bundle, `config-console.js`, and `typert.js`. No dsh process was running, so no user process was forcibly terminated; the next `web` profile start will load this update.

环境规则：dsh `rc.6` 不能使用 Node 20 启动；如果 profile 的 pnpm 被用户目录上层的 Yarn `packageManager` 拦截，必须把独立 pnpm 放在 PATH 前面再执行 dsh plugin 管理命令。

Environment rule: dsh `rc.6` must not be started with Node 20. If profile pnpm is intercepted by the Yarn `packageManager` field in a parent user directory, put standalone pnpm first in PATH before running dsh plugin management commands.
