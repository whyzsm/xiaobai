# 运行流程与副作用规范 / Runtime Flow And Side Effect Guidelines

## 中文

### 命令入口

小白的主要入口是 `npm run loop -- <command>`，最终执行 `dist/loop-engineering/cli/loop.js`。源码入口 `loop-engineering/cli/loop.ts` 的本地模式是：

- `memory` 子命令交给 `loop-engineering/cli/memory.ts`。
- `validate` 先加载 loop spec，再通过 `validateWorkspace` 检查 schema 和引用文件。
- `dry-run` 必须先验证 workspace，随后用 `LoopRuntime.dryRun` 生成计划。
- `simulate` 必须先验证 workspace，随后用 `SimulationRuntime.simulate` 生成模拟结果。

新增命令时，不要把复杂业务逻辑塞进 `parseArgs` 或输出函数；命令入口只负责边界处理。

### 写入和 preview

Memory 命令的本地模式是 preview 优先、`--write` 才落盘。参考 `loop-engineering/cli/memory.ts`：

- `checkpoint` 需要 `--body <markdown-file>`，写 case、snapshot、index 和 `checkpoints.jsonl`。
- `audit-today` 读取当天 `checkpoints.jsonl`，当天无 checkpoint 时返回失败。
- `init`、`index`、`snapshot` 等命令要明确 preview 和 write 结果。

不要让新 memory 命令默认静默写入，也不要在写入失败后声称记忆已经持久化。

### Preflight 和回滚

控制面必须先 preflight 再创建 workspace。`WorkspaceControlPlane.createWorkspaceInternal` 的模式是：

- 标准化输入。
- 执行 `preflight` 收集 `PreflightIssue[]`。
- 创建 workspace/background/project definition/state。
- 发生错误时倒序清理本次创建的 managed directory。

新增 control-plane 行为时，保持“先验证、再写入、失败清理”的结构，不要把不可恢复写入放在验证之前。

### Hook 与外部集成

- Codex Trellis hooks 由 `.codex/hooks.json` 调用 `.codex/hooks/*.py`，还需要用户级 `~/.codex/config.toml` 开启 hooks 并在 Codex TUI 批准。
- Connector 凭据应使用 `auth.type: env` 和 `tokenEnv`，参考 `workspace/connectors/yuque.yaml` 的测试断言。
- OpenHands 启动、停止、doctor 和 package 脚本只属于 `deploy/openhands/` 适配层，不应改变 loop runtime 真源。

### 常见错误

- 不要把 `validate` 省略掉后直接做 `dry-run` 或 `simulate` 的语义判断。
- 不要在没有用户确认时运行仓库规则要求确认的 `npm run validate` 或 `npm test`。
- 不要把 `/v1/models`、健康检查或 CLI 成功输出误报成业务验收完成。
- 不要把 hook 自动注入当作必然发生；hook 未批准时，要手动运行 `get_context.py`。

## English

### Command Entrypoints

The main Xiaobai entrypoint is `npm run loop -- <command>`, which executes `dist/loop-engineering/cli/loop.js`. The source entrypoint `loop-engineering/cli/loop.ts` follows this local pattern:

- The `memory` subcommand is delegated to `loop-engineering/cli/memory.ts`.
- `validate` loads loop specs and then checks schemas and referenced files through `validateWorkspace`.
- `dry-run` validates the workspace first, then uses `LoopRuntime.dryRun` to produce a plan.
- `simulate` validates the workspace first, then uses `SimulationRuntime.simulate` to produce a simulation result.

When adding commands, do not put complex business logic into `parseArgs` or output functions. The command entrypoint should own only boundary handling.

### Writes And Preview

Memory commands are preview-first, and disk writes require `--write`. See `loop-engineering/cli/memory.ts`:

- `checkpoint` requires `--body <markdown-file>` and writes a case, snapshot, index, and `checkpoints.jsonl`.
- `audit-today` reads today's `checkpoints.jsonl` entries and fails when no checkpoint exists for the day.
- `init`, `index`, `snapshot`, and related commands must distinguish preview and write results.

Do not make new memory commands write silently by default, and do not claim memory persistence after a failed write.

### Preflight And Rollback

The control plane must preflight before creating a workspace. `WorkspaceControlPlane.createWorkspaceInternal` follows this pattern:

- Normalize input.
- Run `preflight` and collect `PreflightIssue[]`.
- Create workspace, background, project definition, and state.
- On error, clean up managed directories created during the operation in reverse order.

When adding control-plane behavior, preserve the validate-first, write-second, cleanup-on-failure structure. Do not put unrecoverable writes before validation.

### Hooks And External Integration

- Codex Trellis hooks are wired through `.codex/hooks.json` and call `.codex/hooks/*.py`; they also require user-level hooks in `~/.codex/config.toml` and one-time approval in the Codex TUI.
- Connector credentials should use `auth.type: env` and `tokenEnv`, as asserted for `workspace/connectors/yuque.yaml`.
- OpenHands start, stop, doctor, and package scripts belong only to the `deploy/openhands/` adapter layer and must not change the loop runtime source of truth.

### Common Mistakes

- Do not skip `validate` and then rely on `dry-run` or `simulate` semantics.
- Do not run `npm run validate` or `npm test` without user confirmation when repository rules require confirmation.
- Do not report health checks, `/v1/models`, or CLI success output as completed business acceptance.
- Do not assume hook auto-injection always happened; when hooks are not approved, run `get_context.py` manually.
