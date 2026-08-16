# Provider 支持等级 / Provider Support Levels

## 中文

小白把 AI 工具分成入口和 provider。入口只负责提交、查询或领取任务；provider 负责在小白给定的任务、上下文、workspace lease 和门禁约束内执行。

## English

Xiaobai separates AI tools into entry points and providers. Entry points only submit, query, or claim tasks; providers execute within Xiaobai's task, context, workspace lease, and gate constraints.

## 中文

支持等级含义：

- `supported`：已经通过本机或 CI 冒烟测试，且输出结构、sandbox 假设、失败路径和验证证据都有记录。
- `experimental`：registry 已有 profile，但尚未完成真实写入冒烟或版本认证；只能用于受控实验。
- `client_only`：外部 AI 可以通过 CLI、MCP 或 ACP 提交结果，但小白不负责启动该 AI，也不信任其 sandbox；提交结果必须重新经过 Harness、evaluator、diff 和策略检查。

## English

Support level meanings:

- `supported`: local or CI smoke tests have passed, with recorded output shape, sandbox assumptions, failure paths, and verification evidence.
- `experimental`: a registry profile exists, but real writable smoke tests or version certification are not complete; use only for controlled experiments.
- `client_only`: the external AI may submit results through CLI, MCP, or ACP, but Xiaobai does not launch that AI or trust its sandbox; submissions must be rechecked through Harness, evaluator, diff, and policy gates.

## 中文

当前 profile：

| Profile | 模式 | 等级 | 说明 |
| --- | --- | --- | --- |
| `codex-cli-read-only` | managed | `supported` | 当前已有只读 Codex CLI 执行路径，使用 `--sandbox read-only`。 |
| `codex-cli-writable` | managed | `experimental` | 已有 lease-scoped `workspace-write` profile 和前置阻断，但还需要真实 Codex 写入冒烟后才能升级。 |
| `claude-code-managed` | managed | `experimental` | 预留 Claude Code managed profile；需要验证本机命令、非交互输出和 sandbox 边界。 |
| `gemini-cli-managed` | managed | `experimental` | 预留 Gemini CLI managed profile；需要验证本机命令、非交互输出和 sandbox 边界。 |
| `client-submission` | client | `client_only` | 通用外部 AI 提交入口；小白只接收结果并重新验证。 |
| `zcode-client` | client | `client_only` | ZCode 暂不宣称 managed 支持，先按外部 client 处理。 |
| `workbuddy-client` | client | `client_only` | WorkBuddy 暂不宣称 managed 支持，先按外部 client 处理。 |

DeepSeek Harness / DSH 的 ACP 子进程入口不属于 provider registry profile；它是外部 harness 到小白 task runtime 的入口。当前状态是：小白 ACP stdio server 与 DSH `@deepseek-ai/dsh-subagent-acp@0.1.0-rc.6` 的本机 smoke 已通过，可用于创建小白任务；外部 AI 产出的写入结果仍必须走 `client-submission` 重新验证。

## English

Current profiles:

| Profile | Mode | Level | Notes |
| --- | --- | --- | --- |
| `codex-cli-read-only` | managed | `supported` | Existing read-only Codex CLI execution path using `--sandbox read-only`. |
| `codex-cli-writable` | managed | `experimental` | Lease-scoped `workspace-write` profile and preflight blocking exist, but real Codex writable smoke tests are still required before promotion. |
| `claude-code-managed` | managed | `experimental` | Reserved Claude Code managed profile; local command, non-interactive output, and sandbox boundaries still need verification. |
| `gemini-cli-managed` | managed | `experimental` | Reserved Gemini CLI managed profile; local command, non-interactive output, and sandbox boundaries still need verification. |
| `client-submission` | client | `client_only` | Generic external AI submission path; Xiaobai accepts the result and revalidates it. |
| `zcode-client` | client | `client_only` | ZCode is not claimed as managed support yet; treat it as an external client. |
| `workbuddy-client` | client | `client_only` | WorkBuddy is not claimed as managed support yet; treat it as an external client. |

The DeepSeek Harness / DSH ACP subprocess entry is not a provider registry profile; it is an entry point from an external harness into Xiaobai's task runtime. Current status: the Xiaobai ACP stdio server passed a local smoke test with DSH `@deepseek-ai/dsh-subagent-acp@0.1.0-rc.6` and can create Xiaobai tasks; write results produced by external AI still have to pass `client-submission` revalidation.

## 中文

本机认证证据，采集日期：2026-08-15。

| 项目 | 结果 |
| --- | --- |
| DSH Node 版本 | 默认 Node `v20.10.0` 会因 `node:util.parseEnv` 缺失失败；`fnm exec --using 24` 下 Node `v24.19.0` 可运行。 |
| DSH 包版本 | `@deepseek-ai/dsh` 当前 npm `latest/next` 均为 `0.1.0-rc.6`。 |
| DSH ACP provider 包版本 | `@deepseek-ai/dsh-subagent-acp` 的 `next` 为 `0.1.0-rc.6`，但 `latest` 仍为 `0.0.1-rc.1`；安装时必须显式写 `@0.1.0-rc.6`。 |
| DSH profile 接入方式 | 该 provider 包没有声明 `dsh.bundle`，`dsh plugin add` 只会安装依赖，不会自动加入 profile；需要在 `cordis.patch.yml` 用顶层 `insert` 增加 `@deepseek-ai/dsh-subagent-acp` 条目。 |
| DSH → 小白 ACP smoke | 通过。临时 headless profile 注册 provider 后，DSH `ctx.subagents.list()` 返回 `spawn`、`fork`、`xiaobai`，`ctx.subagents.start('xiaobai')` 返回 `stopReason: completed`，输出包含 `xiaobai_acp_task_created`。 |
| Codex writable smoke | 未通过。`codex-cli 0.144.1` 在临时 `/tmp` fixture 中没有写出 `--output-last-message` 文件，README 未变更，`changedFiles` 为空；push 请求在 provider 前置检查中被阻断。 |
| Claude Code | 本机有 `claude 2.1.150`，但小白仓库目前没有 Claude managed adapter，不能认证为 supported。 |
| Gemini CLI | 本机有 `gemini 0.43.0`，但 `~/.gemini/settings.json` 的 `output.format: markdown` 不符合 CLI 要求的 `text | json`，且小白仓库目前没有 Gemini managed adapter，不能认证为 supported。 |
| ZCode / WorkBuddy | 本机未发现 `zcode` 或 `workbuddy` 命令；保持 `client_only`。 |

## English

Local certification evidence, collected on 2026-08-15.

| Item | Result |
| --- | --- |
| DSH Node version | The default Node `v20.10.0` fails because `node:util.parseEnv` is missing; Node `v24.19.0` works under `fnm exec --using 24`. |
| DSH package version | npm reports `@deepseek-ai/dsh` `latest/next` as `0.1.0-rc.6`. |
| DSH ACP provider package version | `@deepseek-ai/dsh-subagent-acp` has `next` at `0.1.0-rc.6`, while `latest` is still `0.0.1-rc.1`; installs must pin `@0.1.0-rc.6`. |
| DSH profile integration | The provider package does not declare `dsh.bundle`, so `dsh plugin add` installs only the dependency and does not add it to the profile automatically; add an `@deepseek-ai/dsh-subagent-acp` entry through a top-level `insert` in `cordis.patch.yml`. |
| DSH → Xiaobai ACP smoke | Passed. After registering the provider in a temporary headless profile, DSH `ctx.subagents.list()` returned `spawn`, `fork`, and `xiaobai`; `ctx.subagents.start('xiaobai')` returned `stopReason: completed`, and the output contained `xiaobai_acp_task_created`. |
| Codex writable smoke | Failed. `codex-cli 0.144.1` did not write the `--output-last-message` file in a temporary `/tmp` fixture, README was unchanged, and `changedFiles` was empty; a push request was blocked by provider preflight checks. |
| Claude Code | Local `claude 2.1.150` exists, but this Xiaobai repository does not yet include a Claude managed adapter, so it cannot be certified as supported. |
| Gemini CLI | Local `gemini 0.43.0` exists, but `~/.gemini/settings.json` has `output.format: markdown`, while the CLI requires `text | json`; this Xiaobai repository also lacks a Gemini managed adapter, so it cannot be certified as supported. |
| ZCode / WorkBuddy | No local `zcode` or `workbuddy` command was found; keep them `client_only`. |

## 中文

升级规则：任何 `experimental` 或 `client_only` profile 只有在完成真实 fixture 任务、记录 changed files、diff、验证命令、Harness 结果、evaluator 结果和 sandbox 证据后，才能提升为 `supported`。

## English

Promotion rule: an `experimental` or `client_only` profile may be promoted to `supported` only after a real fixture task records changed files, diff, verification commands, Harness result, evaluator result, and sandbox evidence.
