# 小白 Agent Ops / Xiaobai Agent Ops

## 中文

### 定位

小白 Agent Ops 是 Loop Engineering 运行空间的只读监控界面。它聚合当前 Git、Loop、Agent、Harness、项目注册、Memory、评价门禁和 Understand Anything 图谱快照，但不替代这些对象各自的真源。

页面只帮助维护者识别当前配置、运行证据和可观测性缺口。它不执行路由、修改任务状态、刷新正式知识图谱、写入 Memory、提交代码或推送远端。

### 数据真源

- Loop：`workspace/loops/*.yaml`
- Agent 与 Harness：`workspace/agents/*.yaml`
- 项目注册：`workspace/projects/*/.loop/project.yaml`
- Memory：默认 `workspace/memory`，或本机 `workspace/workspace.local.yaml` 声明的 `memoryRoot`
- 节点事件：`<memoryRoot>/loops/<loop-id>/stage-events.jsonl`
- 图谱：`.understand-anything/knowledge-graph.json` 与 `.understand-anything/meta.json`
- 评价规则：`loop-engineering/docs/xiaobai-evaluation-engineering-system.md`
- Git 状态：当前工程仓的本地分支、HEAD、上游差异和工作区状态

监控快照只保留聚合数量、状态、相对真源标识和非敏感时间戳。它不输出本机绝对路径、远端地址、Memory 正文、访问令牌或凭证。

### 启动

```bash
npm run dashboard:xiaobai
```

启动脚本会执行以下本机操作：

1. 构建当前 TypeScript 引擎，确保监控复用同一份节点计时投影。
2. 生成 `workspace/.local/monitoring/monitor-data.json`。
3. 在 `127.0.0.1:8766` 开始寻找可用端口，最多尝试到 `8775`。
4. 生成随机访问令牌，并把完整 Dashboard 地址输出到终端。
5. 使用系统默认浏览器打开该地址。

如果只需要启动服务而不自动打开浏览器：

```bash
npm run dashboard:xiaobai -- --no-open
```

如果需要指定起始端口：

```bash
npm run dashboard:xiaobai -- --port 8876
```

### 节点停留时间

`ExecutionRuntime` 把版本化事件追加到 `<memoryRoot>/loops/<loop-id>/stage-events.jsonl`。Dashboard 逐行读取该真源，并复用引擎的 `projectStageTiming`：每个 Loop 选择 `occurredAt` 最近的 run，每个 task/stage 选择最新 attempt，再展示 `enteredAt`、`firstActionAt`、`exitedAt`、`durationMs`、`activeMs`、`waitingMs`、`waitingReason`、status 和事件日志证据。

没有事件的配置节点保持 `unmeasured` 和 `missing_instrumentation`。倒序、重复、身份漂移、未闭合等待、损坏 JSONL 或其他无效流保持 `unmeasured`/`invalid`，耗时字段为 `null`；监控层不得根据文件时间、命令耗时、对话时间或 simulation 产物估算节点停留时间。Loop 没有声明 `workflow.stages` 时，页面同时报告 `missing_workflow_stage_contract`。

### 安全边界

- 服务只绑定 `127.0.0.1`。
- 数据、刷新和图谱端点都要求启动时生成的随机令牌。
- 服务不设置跨域访问许可。
- 刷新只重建被 Git 忽略的本机快照，不修改正式配置或运行证据。
- 监控只读 StageEvent；它不执行节点、不授予 GatePass，也不管理 run 锁。
- StageEvent 权威范围是 `local_single_executor`，同步 JSONL 不被声明为跨机器分布式权威。
- Codex adapter 仅允许 read-only sandbox；未配置 engine-owned action broker 的写节点会在进程启动前阻断。
- `npm run validate` 与 `npm test` 在页面中明确标记为需要人工确认，页面本身不会执行任何命令。
- `.xiaobai-data`、`workspace/.local` 和外部仓库内容不会进入工程仓提交。

### 聚焦验证

```bash
npm run build --silent
node --check workspace/monitoring/scripts/generate-monitor-data.mjs
node --check workspace/monitoring/scripts/start-dashboard.mjs
node workspace/monitoring/scripts/generate-monitor-data.mjs --stdout
git diff --check
```

`npm run validate` 与 `npm test` 属于人工确认门禁，执行前必须获得用户确认。

## English

### Positioning

Xiaobai Agent Ops is a read-only monitoring surface for the Loop Engineering operating space. It aggregates the current Git state, loops, agents, harnesses, project registry, memory, evaluation gates, and the Understand Anything graph snapshot without replacing any of their sources of truth.

The page helps maintainers identify current configuration, execution evidence, and observability gaps. It does not perform routing, mutate task state, refresh the formal knowledge graph, write memory, commit code, or push to a remote.

### Data Sources

- Loops: `workspace/loops/*.yaml`
- Agents and harnesses: `workspace/agents/*.yaml`
- Project registry: `workspace/projects/*/.loop/project.yaml`
- Memory: `workspace/memory` by default, or the `memoryRoot` declared in machine-local `workspace/workspace.local.yaml`
- Stage events: `<memoryRoot>/loops/<loop-id>/stage-events.jsonl`
- Graph: `.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json`
- Evaluation policy: `loop-engineering/docs/xiaobai-evaluation-engineering-system.md`
- Git state: local branch, HEAD, upstream distance, and worktree state for this engineering repository

The monitoring snapshot keeps only aggregate counts, statuses, relative source identifiers, and non-sensitive timestamps. It does not expose absolute machine paths, remote URLs, memory content, access tokens, or credentials.

### Start

```bash
npm run dashboard:xiaobai
```

The launcher performs these local operations:

1. Builds the current TypeScript engine so monitoring reuses the same stage-timing projection.
2. Generates `workspace/.local/monitoring/monitor-data.json`.
3. Searches for an available loopback port from `127.0.0.1:8766` through `8775`.
4. Generates a random access token and prints the complete Dashboard URL in the terminal.
5. Opens that URL in the system default browser.

To start the service without opening a browser:

```bash
npm run dashboard:xiaobai -- --no-open
```

To choose the first port to try:

```bash
npm run dashboard:xiaobai -- --port 8876
```

### Stage Dwell Time

`ExecutionRuntime` appends versioned events to `<memoryRoot>/loops/<loop-id>/stage-events.jsonl`. The Dashboard reads that source line by line and reuses the engine's `projectStageTiming`: it selects the run with the latest `occurredAt` for each loop and the latest attempt for each task/stage, then presents `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, `waitingMs`, `waitingReason`, status, and event-log evidence.

Configured stages without events remain `unmeasured` with `missing_instrumentation`. Out-of-order, duplicate, identity-drifting, open-wait, malformed JSONL, and other invalid streams remain `unmeasured`/`invalid` with `null` duration fields. Monitoring must not estimate dwell time from file timestamps, command duration, conversation time, or simulation artifacts. When a loop does not declare `workflow.stages`, the page also reports `missing_workflow_stage_contract`.

### Security Boundary

- The service binds only to `127.0.0.1`.
- Data, refresh, and graph endpoints require the random token created at startup.
- The service does not grant cross-origin access.
- Refresh rebuilds only the Git-ignored local snapshot and does not modify formal configuration or runtime evidence.
- Monitoring reads StageEvents only; it does not execute stages, grant GatePasses, or manage run locks.
- StageEvent authority is scoped to `local_single_executor`; synchronized JSONL is not presented as cross-machine distributed authority.
- The Codex adapter permits only a read-only sandbox; mutation stages without an engine-owned action broker are blocked before process startup.
- `npm run validate` and `npm test` are visibly marked as human-confirmed gates, and the page never executes commands.
- `.xiaobai-data`, `workspace/.local`, and external repository contents remain outside this repository's commit boundary.

### Focused Verification

```bash
npm run build --silent
node --check workspace/monitoring/scripts/generate-monitor-data.mjs
node --check workspace/monitoring/scripts/start-dashboard.mjs
node workspace/monitoring/scripts/generate-monitor-data.mjs --stdout
git diff --check
```

`npm run validate` and `npm test` are human-confirmed gates and require user approval before execution.
