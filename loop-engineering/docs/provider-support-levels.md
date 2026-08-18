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

`loop execute` 默认拒绝 `experimental` profile。受控实验必须显式传入 `--allow-experimental-provider true`；该开关只授权当前执行尝试，不会改变 profile 的支持等级，也不会绕过 workspace、Harness、evaluator、diff 或人类门禁。

## English

Support level meanings:

- `supported`: local or CI smoke tests have passed, with recorded output shape, sandbox assumptions, failure paths, and verification evidence.
- `experimental`: a registry profile exists, but real writable smoke tests or version certification are not complete; use only for controlled experiments.
- `client_only`: the external AI may submit results through CLI, MCP, or ACP, but Xiaobai does not launch that AI or trust its sandbox; submissions must be rechecked through Harness, evaluator, diff, and policy gates.

`loop execute` rejects `experimental` profiles by default. A controlled experiment must explicitly pass `--allow-experimental-provider true`; this flag authorizes only the current execution attempt, does not change the profile support level, and does not bypass workspace, Harness, evaluator, diff, or human gates.

## 中文

当前 profile：

| Profile | 模式 | 等级 | 说明 |
| --- | --- | --- | --- |
| `codex-cli-read-only` | managed | `supported` | 当前已有只读 Codex CLI 执行路径，使用 `--sandbox read-only`。 |
| `codex-cli-writable` | managed | `experimental` | 已有 lease-scoped `workspace-write` profile、前置阻断、stdin prompt 调用、可选用户 Codex config、可选 prompt-only schema 兼容模式和 JSONL 失败归因；本机第三方中转兼容模式写入冒烟已通过，但默认严格 schema 模式仍失败，升级前还需要把兼容模式固化为认证 profile。 |
| `claude-code-managed` | managed | `experimental` | 已有 Claude Code managed adapter、lease cwd 前置阻断、stdout/result JSON 解析、Claude Code `structured_output` 解析和 debug API 失败归因；本机真实写入 smoke 已通过，但还缺完整 evaluator 与 sandbox 认证证据，暂不升级。 |
| `gemini-cli-managed` | managed | `experimental` | 已有 Gemini CLI managed adapter、lease cwd 前置阻断、headless JSON `.response` 解析、prompt-only schema 和超时失败归因；本机真实写入 smoke 失败于 `ETIMEDOUT`，不能升级。 |
| `client-submission` | client | `client_only` | 通用外部 AI 提交入口；小白只接收结果并重新验证。 |
| `zcode-client` | client | `client_only` | ZCode 暂不宣称 managed 支持，先按外部 client 处理。 |
| `workbuddy-client` | client | `client_only` | WorkBuddy 暂不宣称 managed 支持，先按外部 client 处理。 |

DeepSeek Harness / DSH 的 ACP 子进程入口不属于 provider registry profile；它是外部 harness 到小白 task runtime 的入口。当前状态是：小白 ACP stdio server 与 DSH `@deepseek-ai/dsh-subagent-acp@0.1.0-rc.6` 的本机 smoke 已通过，可用于创建小白任务；外部 AI 产出的写入结果仍必须走 `client-submission` 重新验证。

## English

Current profiles:

| Profile | Mode | Level | Notes |
| --- | --- | --- | --- |
| `codex-cli-read-only` | managed | `supported` | Existing read-only Codex CLI execution path using `--sandbox read-only`. |
| `codex-cli-writable` | managed | `experimental` | Lease-scoped `workspace-write` profile, preflight blocking, stdin prompt invocation, optional user Codex config, optional prompt-only schema compatibility mode, and JSONL failure attribution exist; the local third-party relay compatibility writable smoke passed, but the default strict schema mode still fails, so promotion still needs a certified compatibility profile. |
| `claude-code-managed` | managed | `experimental` | Claude Code managed adapter, lease-scoped cwd preflight, stdout/result JSON parsing, Claude Code `structured_output` parsing, and debug API failure attribution exist; the local real writable smoke now passes, but full evaluator and sandbox certification evidence is still missing, so it is not promoted yet. |
| `gemini-cli-managed` | managed | `experimental` | Gemini CLI managed adapter, lease-scoped cwd preflight, headless JSON `.response` parsing, prompt-only schema, and timeout failure attribution exist; the local real writable smoke fails with `ETIMEDOUT`, so it cannot be promoted. |
| `client-submission` | client | `client_only` | Generic external AI submission path; Xiaobai accepts the result and revalidates it. |
| `zcode-client` | client | `client_only` | ZCode is not claimed as managed support yet; treat it as an external client. |
| `workbuddy-client` | client | `client_only` | WorkBuddy is not claimed as managed support yet; treat it as an external client. |

The DeepSeek Harness / DSH ACP subprocess entry is not a provider registry profile; it is an entry point from an external harness into Xiaobai's task runtime. Current status: the Xiaobai ACP stdio server passed a local smoke test with DSH `@deepseek-ai/dsh-subagent-acp@0.1.0-rc.6` and can create Xiaobai tasks; write results produced by external AI still have to pass `client-submission` revalidation.

## 中文

本机认证证据，采集日期：2026-08-15 至 2026-08-16。

| 项目 | 结果 |
| --- | --- |
| DSH Node 版本 | 默认 Node `v20.10.0` 会因 `node:util.parseEnv` 缺失失败；`fnm exec --using 24` 下 Node `v24.19.0` 可运行。 |
| DSH 包版本 | `@deepseek-ai/dsh` 当前 npm `latest/next` 均为 `0.1.0-rc.6`。 |
| DSH ACP provider 包版本 | `@deepseek-ai/dsh-subagent-acp` 的 `next` 为 `0.1.0-rc.6`，但 `latest` 仍为 `0.0.1-rc.1`；安装时必须显式写 `@0.1.0-rc.6`。 |
| DSH profile 接入方式 | 该 provider 包没有声明 `dsh.bundle`，`dsh plugin add` 只会安装依赖，不会自动加入 profile；需要在 `cordis.patch.yml` 用顶层 `insert` 增加 `@deepseek-ai/dsh-subagent-acp` 条目。 |
| DSH → 小白 ACP smoke | 通过。临时 headless profile 注册 provider 后，DSH `ctx.subagents.list()` 返回 `spawn`、`fork`、`xiaobai`，`ctx.subagents.start('xiaobai')` 返回 `stopReason: completed`，输出包含 `xiaobai_acp_task_created`。 |
| Codex writable smoke | 部分通过。旧调用把 prompt 放在 argv 末尾时，Codex CLI 会继续等待 stdin 附加输入；adapter 已改为 `codex exec ... -` 并通过 stdin 传 prompt，fixture 测试能证明 argv 不携带 prompt，stdout JSONL 的 `turn.failed` 能脱敏归因为 `codex_cli_failed`。最小 `codex exec` read-only 当前可通过本机第三方中转返回 `{\"ok\":true}`。矩阵测试显示失败点是 `--output-schema`：read-only 加 schema 和 workspace-write 加 schema 都会让 `http://39.170.58.150:8888/v1/responses` 返回 `502 Bad Gateway`；workspace-write 不加 schema 能正常改 README。adapter 新增 `--codex-ignore-user-config false --codex-output-schema false` 兼容模式后，真实 writable smoke 已写入 README，并返回包含 `changedFiles`、`diffSummary`、`verificationCommands` 和 evidence array 的 submission。由于默认严格 schema 模式仍失败，当前仍保持 `experimental`。 |
| Claude Code | 本机有 `claude 2.1.150`，小白已新增 Claude managed adapter 和 fixture 覆盖；`claude auth status` 显示 `loggedIn: true`、`authMethod: oauth_token`、`apiProvider: firstParty`。本机配置中 `~/.claude/settings.json` 使用 `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`、`ANTHROPIC_MODEL=glm-5` 和 `ANTHROPIC_AUTH_TOKEN`；直接把该 token 当作 BigModel/Z.ai Anthropic 兼容 API key 调用会返回 `401 身份验证失败`，因此不能把 OAuth token 与第三方 API key 语义混用。通过 Claude Code CLI 的 provider/auth 路径运行 `claude -p --output-format json --json-schema ... --permission-mode acceptEdits --allowedTools Read,Edit` 已成功 dispatch 到 `firstParty model=glm-5`。真实小白 Claude writable smoke 已写入 README 并返回 `changedFiles`、`diffSummary`、`verificationCommands` 和 evidence；adapter 已修复 Claude Code 外层 `structured_output` 解析。由于还缺完整 evaluator 与 sandbox 认证证据，当前仍保持 `experimental`。 |
| Gemini CLI | 本机有 `gemini 0.43.0`。原 `~/.gemini/settings.json` 为只读 `444`，且 `output.format: markdown` 不符合 CLI 要求的 `text | json`；已修为用户可写 `644` 和 `output.format: json`。小白已新增 Gemini managed adapter，命令为 `gemini -p <stdin-instructions> --output-format json --skip-trust --approval-mode auto_edit`，fixture 覆盖 `.response` JSON 解析、lease cwd 阻断和超时失败归因。真实 Gemini writable smoke 在 10 秒与 45 秒窗口内均无模型输出，adapter 返回 `gemini_cli_failed: exit=ETIMEDOUT`，README 未变更，因此不能认证为 supported。 |
| ZCode / WorkBuddy | 本机未发现 `zcode` 或 `workbuddy` 命令；保持 `client_only`。 |

## English

Local certification evidence, collected from 2026-08-15 to 2026-08-16.

| Item | Result |
| --- | --- |
| DSH Node version | The default Node `v20.10.0` fails because `node:util.parseEnv` is missing; Node `v24.19.0` works under `fnm exec --using 24`. |
| DSH package version | npm reports `@deepseek-ai/dsh` `latest/next` as `0.1.0-rc.6`. |
| DSH ACP provider package version | `@deepseek-ai/dsh-subagent-acp` has `next` at `0.1.0-rc.6`, while `latest` is still `0.0.1-rc.1`; installs must pin `@0.1.0-rc.6`. |
| DSH profile integration | The provider package does not declare `dsh.bundle`, so `dsh plugin add` installs only the dependency and does not add it to the profile automatically; add an `@deepseek-ai/dsh-subagent-acp` entry through a top-level `insert` in `cordis.patch.yml`. |
| DSH → Xiaobai ACP smoke | Passed. After registering the provider in a temporary headless profile, DSH `ctx.subagents.list()` returned `spawn`, `fork`, and `xiaobai`; `ctx.subagents.start('xiaobai')` returned `stopReason: completed`, and the output contained `xiaobai_acp_task_created`. |
| Codex writable smoke | Partially passed. With the old argv prompt invocation, Codex CLI kept waiting for additional stdin input; the adapter now runs `codex exec ... -` and sends the prompt through stdin, fixture tests prove argv stays prompt-free, and stdout JSONL `turn.failed` is attributed as a sanitized `codex_cli_failed`. A minimal `codex exec` read-only request now succeeds through the local third-party relay and returns `{\"ok\":true}`. Matrix testing shows the failure point is `--output-schema`: read-only with schema and workspace-write with schema both make `http://39.170.58.150:8888/v1/responses` return `502 Bad Gateway`, while workspace-write without schema edits README successfully. With the adapter compatibility mode `--codex-ignore-user-config false --codex-output-schema false`, a real writable smoke wrote README and returned a submission containing `changedFiles`, `diffSummary`, `verificationCommands`, and an evidence array. Because the default strict schema mode still fails, the profile remains `experimental`. |
| Claude Code | Local `claude 2.1.150` exists, and Xiaobai now includes a Claude managed adapter with fixture coverage. `claude auth status` reports `loggedIn: true`, `authMethod: oauth_token`, and `apiProvider: firstParty`. Local `~/.claude/settings.json` uses `ANTHROPIC_BASE_URL=https://open.bigmodel.cn/api/anthropic`, `ANTHROPIC_MODEL=glm-5`, and `ANTHROPIC_AUTH_TOKEN`; directly using that token as a BigModel/Z.ai Anthropic-compatible API key returns `401 身份验证失败`, so OAuth-token semantics must not be mixed with third-party API-key semantics. Through the Claude Code CLI provider/auth path, `claude -p --output-format json --json-schema ... --permission-mode acceptEdits --allowedTools Read,Edit` now dispatches successfully to `firstParty model=glm-5`. A real Xiaobai Claude writable smoke wrote README and returned `changedFiles`, `diffSummary`, `verificationCommands`, and evidence; the adapter now parses Claude Code's outer `structured_output`. Because full evaluator and sandbox certification evidence is still missing, the profile remains `experimental`. |
| Gemini CLI | Local `gemini 0.43.0` exists. The original `~/.gemini/settings.json` was read-only `444` and had `output.format: markdown`, while the CLI requires `text | json`; it has been repaired to user-writable `644` and `output.format: json`. Xiaobai now includes a Gemini managed adapter using `gemini -p <stdin-instructions> --output-format json --skip-trust --approval-mode auto_edit`, with fixture coverage for `.response` JSON parsing, lease-scoped cwd blocking, and timeout attribution. Real Gemini writable smokes produced no model output within both 10-second and 45-second windows; the adapter returned `gemini_cli_failed: exit=ETIMEDOUT`, README was unchanged, and the profile cannot be certified as supported. |
| ZCode / WorkBuddy | No local `zcode` or `workbuddy` command was found; keep them `client_only`. |

## 中文

升级规则：任何 `experimental` 或 `client_only` profile 只有在完成真实 fixture 任务、记录 changed files、diff、验证命令、Harness 结果、evaluator 结果和 sandbox 证据后，才能提升为 `supported`。

## English

Promotion rule: an `experimental` or `client_only` profile may be promoted to `supported` only after a real fixture task records changed files, diff, verification commands, Harness result, evaluator result, and sandbox evidence.
