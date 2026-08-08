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
- 图谱：`.understand-anything/knowledge-graph.json` 与 `.understand-anything/meta.json`
- 评价规则：`loop-engineering/docs/xiaobai-evaluation-engineering-system.md`
- Git 状态：当前工程仓的本地分支、HEAD、上游差异和工作区状态

监控快照只保留聚合数量、状态、相对真源标识和非敏感时间戳。它不输出本机绝对路径、远端地址、Memory 正文、访问令牌或凭证。

### 启动

```bash
npm run dashboard:xiaobai
```

启动脚本会执行以下本机操作：

1. 生成 `workspace/.local/monitoring/monitor-data.json`。
2. 在 `127.0.0.1:8766` 开始寻找可用端口，最多尝试到 `8775`。
3. 生成随机访问令牌，并把完整 Dashboard 地址输出到终端。
4. 使用系统默认浏览器打开该地址。

如果只需要启动服务而不自动打开浏览器：

```bash
node workspace/monitoring/scripts/start-dashboard.mjs --no-open
```

如果需要指定起始端口：

```bash
node workspace/monitoring/scripts/start-dashboard.mjs --port 8876
```

### 节点停留时间

Dashboard 只呈现真实采集的节点计时。当前 runtime 没有持久化 stage timing events，因此 `enteredAt`、`firstActionAt`、`exitedAt`、`durationMs`、`activeMs` 和 `waitingMs` 必须显示为 `unmeasured`，`waitingReason` 必须显示为 `missing_instrumentation`。

Loop 没有声明 `workflow.stages` 时，页面同时报告 `missing_workflow_stage_contract`。监控层不得根据文件时间、命令耗时或对话时间估算节点停留时间。

### 安全边界

- 服务只绑定 `127.0.0.1`。
- 数据、刷新和图谱端点都要求启动时生成的随机令牌。
- 服务不设置跨域访问许可。
- 刷新只重建被 Git 忽略的本机快照，不修改正式配置或运行证据。
- `npm run validate` 与 `npm test` 在页面中明确标记为需要人工确认，页面本身不会执行任何命令。
- `.xiaobai-data`、`workspace/.local` 和外部仓库内容不会进入工程仓提交。

### 聚焦验证

```bash
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
- Graph: `.understand-anything/knowledge-graph.json` and `.understand-anything/meta.json`
- Evaluation policy: `loop-engineering/docs/xiaobai-evaluation-engineering-system.md`
- Git state: local branch, HEAD, upstream distance, and worktree state for this engineering repository

The monitoring snapshot keeps only aggregate counts, statuses, relative source identifiers, and non-sensitive timestamps. It does not expose absolute machine paths, remote URLs, memory content, access tokens, or credentials.

### Start

```bash
npm run dashboard:xiaobai
```

The launcher performs these local operations:

1. Generates `workspace/.local/monitoring/monitor-data.json`.
2. Searches for an available loopback port from `127.0.0.1:8766` through `8775`.
3. Generates a random access token and prints the complete Dashboard URL in the terminal.
4. Opens that URL in the system default browser.

To start the service without opening a browser:

```bash
node workspace/monitoring/scripts/start-dashboard.mjs --no-open
```

To choose the first port to try:

```bash
node workspace/monitoring/scripts/start-dashboard.mjs --port 8876
```

### Stage Dwell Time

The Dashboard presents only stage timing that was actually collected. The current runtime does not persist stage timing events, so `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, and `waitingMs` must be shown as `unmeasured`, while `waitingReason` must be `missing_instrumentation`.

When a loop does not declare `workflow.stages`, the page also reports `missing_workflow_stage_contract`. The monitoring layer must not estimate dwell time from file timestamps, command duration, or conversation time.

### Security Boundary

- The service binds only to `127.0.0.1`.
- Data, refresh, and graph endpoints require the random token created at startup.
- The service does not grant cross-origin access.
- Refresh rebuilds only the Git-ignored local snapshot and does not modify formal configuration or runtime evidence.
- `npm run validate` and `npm test` are visibly marked as human-confirmed gates, and the page never executes commands.
- `.xiaobai-data`, `workspace/.local`, and external repository contents remain outside this repository's commit boundary.

### Focused Verification

```bash
node --check workspace/monitoring/scripts/generate-monitor-data.mjs
node --check workspace/monitoring/scripts/start-dashboard.mjs
node workspace/monitoring/scripts/generate-monitor-data.mjs --stdout
git diff --check
```

`npm run validate` and `npm test` are human-confirmed gates and require user approval before execution.
