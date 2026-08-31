# Loop Engineering 工程说明 / Loop Engineering Guide

本工程按共享对话里的《Loop Engineering 橙皮书》思路搭建，目标不是做一个单次 agent runner，而是把“发现、交付、验证、持久化、调度”拆成可维护、可审计、可扩展的工程系统。

This repository follows the Loop Engineering approach. Its goal is not a one-shot agent runner, but a maintainable, auditable, and extensible system that separates discovery, delivery, verification, persistence, and scheduling.

核心边界：

Core boundaries:

```text
loop-engineering/ = 引擎层，放 runtime、schema、模板、CLI、测试
workspace/        = 运行空间，放 loop 配置、项目知识、agent、connector、memory、worktree、budget
```

当前版本包含确定性规划与模拟骨架，以及一个受限的真实执行 pilot：`execute` 可通过本机 Codex CLI 执行符合条件的只读节点，并由统一 runtime 强制执行 Gate、Harness、本机运行锁和追加式节点事件。它不会创建 PR，也不会向目标仓开放无代理写权限；写节点和受保护 action 在 engine-owned action broker 完成前会明确阻断。

The current version includes deterministic planning and simulation plus a constrained real-execution pilot. `execute` can run eligible read-only stages through the local Codex CLI, while the unified runtime enforces gates, Harness validation, a local run lock, and append-only stage events. It does not create pull requests or grant unbrokered target-repository writes; mutation stages and protected actions are explicitly blocked until an engine-owned action broker exists.

## 快速开始

```bash
npm install
npm run validate
npm run dry-run
npm run simulate
npm test
```

本机配置：

Local configuration:

```bash
# 选择一个 T-MAX 项目，复制该项目的本机路径模板并挂载
# Choose a T-MAX project, copy its local-path template, and mount it
cp workspace/projects/<project>/.loop/local.paths.yaml.example workspace/projects/<project>/.loop/local.paths.yaml
npm run mount:<project>

# 可选：将 memory 指向 Obsidian vault 中的同步目录
# Optional: point memory to a synced directory in an Obsidian vault
cp workspace/workspace.local.yaml.example workspace/workspace.local.yaml
```

常用命令：

```bash
# 校验 loop spec、schema、引用文件
npm run validate

# 生成一次 dry-run 计划，输出 JSON
npm run dry-run

# 指定 loop，输出人类可读计划
npm run loop -- dry-run --loop morning-triage

# 查看前端交付 loop 的 dry-run 计划
# Inspect the frontend delivery loop dry-run plan
npm run loop -- dry-run --json --loop frontend-delivery

# 模拟从初始化、代码仓接入、任务处理到知识沉淀的全过程
npm run simulate

# 初始化 / 校验 / 索引 Obsidian 项目记忆
npm run loop -- memory init --project xbaiProjectCode --write --json
npm run loop -- memory validate --json
npm run loop -- memory index --write --json
npm run loop -- memory search "Loop Engineering" --json
npm run loop -- memory context --loop morning-triage --json

# 在有价值的工作结束后，一次性写入 case、当日快照并刷新索引
# Persist a case, daily snapshot, and refreshed index after meaningful work
npm run loop -- memory checkpoint --project xbaiProjectCode --loop morning-triage --title "工作摘要 / Work summary" --body /path/to/bilingual-summary.md --write --json

# 构建 TypeScript
npm run build

# 构建并运行测试
npm test
```

## 运行链路

一个 loop 的标准运行链路：

```text
1. Scheduler 触发 loop
2. Discovery skill 读取 CI / issue / commit / memory
3. Skill Runtime 生成 findings
4. Worktree Manager 为每个 finding 生成独立 task/worktree/branch 计划
5. Harness Runtime 装配单次 agent run 的工具、权限、完成条件
6. Generator Agent 负责产出修改计划
7. Evaluator Agent 独立审查
8. Memory Store 计划写回 state / inbox / run log
9. Budget Guard 检查预算
10. Human Gate 保留人工复核点
```

抽象成橙皮书语言：

```text
发现 -> 交付 -> 验证 -> 持久化 -> 调度
```

## 目录结构

```text
.
├── package.json                         # npm 脚本、依赖、CLI bin 定义
├── package-lock.json                    # npm 依赖锁定文件
├── tsconfig.json                        # TypeScript 编译配置
├── README.md                            # 工程说明及目录
├── SKILL.md                             # 仓级代码实现 Skill / repository-level implementation Skill
├── loop-engineering/                    # Loop Engineering 引擎层
│   ├── cli/
│   │   └── loop.ts                      # CLI 入口，支持 validate / dry-run / gate / execute
│   ├── docs/
│   │   ├── architecture.md              # 架构说明
│   │   ├── frontend-platform-standards.md # 前端平台工程规范 / frontend platform engineering standards
│   │   └── product-requirement-platform-standards.md # 产品需求平台规范 / product requirement platform standards
│   ├── packages/                        # 按职责拆分的 runtime 包
│   │   ├── loop-runtime/                # 顶层编排：串联各 runtime 生成计划
│   │   ├── scheduler/                   # 调度计划：cron/manual/webhook 等触发描述
│   │   ├── harness-runtime/             # 单次 agent run 的工具、权限、完成条件
│   │   ├── context-engine/              # 上下文装配：skill、memory、connector evidence
│   │   ├── skill-runtime/               # 读取 SKILL.md，并从证据中筛选 findings
│   │   ├── worktree-manager/            # finding -> task/branch/worktree 计划
│   │   ├── connector-runtime/           # 读取 connector 配置和 mock 外部数据
│   │   ├── agent-runtime/               # 读取 generator/evaluator agent 配置
│   │   ├── evaluator-runtime/           # 生成独立 evaluator 审查计划
│   │   ├── memory-store/                # 读取/计划写回磁盘记忆
│   │   ├── memory-protocol/             # Obsidian memory 路径、frontmatter、模板、Markdown 协议
│   │   ├── memory-indexer/              # 扫描项目记忆并生成 memory-index.json
│   │   ├── memory-search/               # 基于索引的确定性检索和评分
│   │   ├── memory-context/              # 为 loop / agent run 装配受预算约束的记忆上下文
│   │   ├── memory-capture/              # case 捕获与 pattern 晋升
│   │   ├── memory-doctor/               # memory validate / doctor 健康诊断
│   │   ├── budget-guard/                # token、重试、并发等预算检查
│   │   ├── human-gate/                  # 人工复核点配置
│   │   ├── execution-runtime/           # Gate/Harness 强制执行、节点事件与 executor adapter
│   │   └── shared/                      # 公共类型、文件读取、schema 校验
│   ├── schemas/                         # JSON Schema，校验配置文件结构
│   │   ├── loop.schema.json
│   │   ├── harness.schema.json
│   │   ├── agent.schema.json
│   │   ├── connector.schema.json
│   │   ├── budget.schema.json
│   │   ├── memory-index.schema.json
│   │   └── memory-note.schema.json
│   ├── templates/                       # 可复制的配置模板
│   │   ├── triage.loop.yaml
│   │   ├── fix-bug.loop.yaml
│   │   ├── evaluator.agent.yaml
│   │   └── project.SKILL.md
│   └── tests/
│       └── runtime.test.ts              # 校验 workspace 与 dry-run 计划
└── workspace/                           # Loop 运行空间
    ├── loops/
    │   ├── morning-triage.loop.yaml     # 当前示例 loop spec，系统核心配置
    │   └── frontend-delivery.loop.yaml  # 前端需求到 PR 就绪的设计门禁 loop / design-gated frontend delivery loop
    ├── projects/
    │   └── app-a/
    │       ├── SKILL.md                 # 项目级工程规则
    │       └── .loop/
    │           ├── project.yaml         # 项目元信息
    │           └── skills/
    │               ├── triage.SKILL.md  # discovery skill
    │               └── fix-tests.SKILL.md
    ├── agents/
    │   ├── coding.harness.yaml          # 单次 agent run 的 harness 配置
    │   ├── generator.agent.yaml         # 生成者 agent 配置
    │   └── evaluator.agent.yaml         # 独立评审 agent 配置
    ├── connectors/
    │   ├── github.yaml                  # GitHub issue/commit/PR connector mock
    │   ├── github-actions.yaml          # CI connector mock
    │   ├── yuque.yaml                   # 语雀需求 connector mock / Yuque requirement connector mock
    │   ├── requirement-input.yaml       # 本地文档和对话需求 connector mock / local document and conversation requirement connector mock
    │   ├── jira.yaml                    # ticket connector mock
    │   └── slack.yaml                   # 通知 connector mock
    ├── budgets/
    │   └── default.budget.yaml          # 默认预算上限
    ├── memory/
    │   └── loops/
    │       └── morning-triage/
    │           ├── state.md             # loop 当前状态，人可读
    │           ├── inbox.md             # 需要人工处理的事项
    │           ├── decisions.md         # 历史决策记录
    │           ├── runs.jsonl           # 每轮运行日志
    │           ├── findings.jsonl       # 发现项记录
    │           └── metrics.jsonl        # token、耗时、成功率等指标
    ├── worktrees/
    │   └── runs/                        # dry-run 会规划到这里，当前不实际创建
    └── reports/
        └── daily/                       # 每日报告输出目录
```

## 核心配置

### Loop Spec

入口文件：

```text
workspace/loops/morning-triage.loop.yaml
workspace/loops/frontend-delivery.loop.yaml
```

它定义一个 loop 如何运行，包括：

- `schedule`: 什么时候触发
- `discovery`: 从哪里发现任务，使用哪个 skill
- `handoff`: 如何把 finding 变成 task/worktree/branch
- `generator`: 使用哪个 generator agent 和 harness
- `verification`: 使用哪个 evaluator，必须跑哪些检查
- `persistence`: 状态写回哪里
- `budget`: 单次运行预算
- `humanGate`: 哪些动作必须人工复核

`frontend-delivery` loop 用于从本地文档、对话输入或语雀需求推进到前端 PR 就绪。它要求先生成主设计文档和各目标仓补充设计文档，通过独立设计评审，并获得 `human-design-approval` 后，才允许进入编码。业务设计正文和业务代码只允许落在当前动态挂载的目标前端仓，工程仓只记录状态、门禁结果、源链接、目标仓和 PR 链接。

The `frontend-delivery` loop moves local document, conversation, or Yuque requirements toward frontend PR readiness. It requires a master design document, repository design supplements, independent design review, and `human-design-approval` before implementation. Business design bodies and business code must be written only to the currently mounted target frontend repositories. The engineering repository records only state, gate results, source links, target repositories, and PR links.

V2 通过 `workflow.stages[]` 显式表达九个阶段：`requirement-intake`、`target-repository-resolution`、`frontend-master-design`、`frontend-repository-design`、`frontend-design-review`、`human-design-approval`、`frontend-implementation`、`implementation-verification`、`pr-readiness`。dry-run 中的 `status: planned` 只表示计划，不代表已真实调用语雀 API、创建分支、写目标仓或创建 PR。语雀 connector 的 `config.baseUrl` 和 `auth.tokenEnv` 只是 API 配置结构，仓库不得保存 token 值。

V2 explicitly represents nine stages through `workflow.stages[]`: `requirement-intake`, `target-repository-resolution`, `frontend-master-design`, `frontend-repository-design`, `frontend-design-review`, `human-design-approval`, `frontend-implementation`, `implementation-verification`, and `pr-readiness`. In dry-run output, `status: planned` means planned only; it does not mean Yuque API calls, branch creation, target repository writes, or PR creation have happened. The Yuque connector `config.baseUrl` and `auth.tokenEnv` fields are API configuration shape only, and the repository must not store token values.

`morning-triage` 通过 `workflow.stages[]` 显式表达六个阶段：`triage-discovery`、`finding-isolation`、`finding-implementation`、`finding-verification`、`pr-readiness` 和 `merge-approval`。每个自动节点必须声明一个 agent 或 evaluator，每个人工节点必须是无 agent/evaluator 的 `human-gate`；`dependsOn` 只能引用已经声明的前置节点，所有全局 verification check 都必须分配到至少一个节点。

`morning-triage` explicitly represents six stages through `workflow.stages[]`: `triage-discovery`, `finding-isolation`, `finding-implementation`, `finding-verification`, `pr-readiness`, and `merge-approval`. Every automatic stage must declare one agent or evaluator, and every manual stage must be an ownerless `human-gate`. A `dependsOn` entry may reference only a previously declared stage, and every loop-level verification check must be assigned to at least one stage.

### Harness Spec

入口文件：

```text
workspace/agents/coding.harness.yaml
```

它只描述一次 agent run 怎么武装，不负责调度下一轮：

- 允许/禁止的工具
- 上下文加载器
- 最大上下文字符数
- 完成条件
- 失败处理策略
- 输出字段要求

`harness-check` 接收外部 agent executor 产生的结构化 run result，并以 fail-closed 方式检查 agent/harness 身份、上下文加载与字符上限、工具白名单/黑名单、完成条件、必需输出和逐项证据。检查失败时命令返回非零退出码；它不会自行调用模型、执行工具或修改业务仓。

```bash
npm run loop -- harness-check --loop morning-triage --result /path/to/run-result.json --json
```

run result 必须包含 `runId`、`taskId`、`agentId`、`harnessId`、`startedAt`、`finishedAt`、`loadedContext`、`contextCharactersUsed`、`toolsUsed`、`completedConditions`、`output` 和 `evidence`。每个已完成条件都必须有对应 `checkId` 的证据记录。

`harness-check` accepts a structured run result produced by an external agent executor. It fails closed when the agent or harness identity is wrong, required context is missing or oversized, a tool violates the allow/deny policy, completion conditions or required outputs are missing, or a claimed condition has no evidence. A failed check returns a non-zero exit code. The command does not call a model, execute tools, or modify a business repository by itself.

The run result must contain `runId`, `taskId`, `agentId`, `harnessId`, `startedAt`, `finishedAt`, `loadedContext`, `contextCharactersUsed`, `toolsUsed`, `completedConditions`, `output`, and `evidence`. Every completed condition must have an evidence record with a matching `checkId`.

### Gate 与 GatePass / Gates And GatePasses

`humanGate.gates[]` 把人工门禁定义为可校验配置。每个 gate 都声明唯一 `id`、受保护动作 `requiredBefore`、允许审批的 `reviewers`、参与摘要计算的 `subjectFields`、必需证据类型 `requiredEvidenceTypes` 和有效期 `maxAgeMinutes`。Loop 顶层 `humanGate.requiredBefore` 与 `humanGate.reviewers` 是 gate 定义的汇总，校验器会阻止两者漂移；manual `human-gate` workflow 节点必须存在同名 gate 定义，自动节点的 `requiredGates` 也只能引用已定义 gate。

`humanGate.gates[]` represents human gates as enforceable configuration. Each gate declares a unique `id`, its protected `requiredBefore` action, authorized `reviewers`, the `subjectFields` included in the subject digest, required `requiredEvidenceTypes`, and `maxAgeMinutes`. The loop-level `humanGate.requiredBefore` and `humanGate.reviewers` fields summarize the gate definitions, and validation rejects drift between them. A manual `human-gate` workflow stage must have a same-ID gate definition, and an automatic stage may reference only defined gates through `requiredGates`.

查看门禁不会写文件：

Listing gates does not write files:

```bash
npm run loop -- gate list --loop frontend-delivery --json
```

审批命令校验审批人和证据后，把一条 `granted` 事件追加到 `<memoryRoot>/loops/<loop-id>/passes.jsonl`。`--stage` 表示通行证只允许进入该受保护 workflow 节点；传入的节点必须显式声明对应 `requiredGates`。调用方通过 `--subject-file` 提交 JSON 对象，引擎严格投影 gate 声明的 `subjectFields`，使用 JCS v1 稳定序列化和 SHA-256 计算 `subjectDigest`，同时记录 gate policy digest。调用方不能自行提交裸摘要。

The approval command validates the issuer and evidence, then appends a `granted` event to `<memoryRoot>/loops/<loop-id>/passes.jsonl`. `--stage` binds the pass to one protected workflow stage, which must explicitly declare the gate in `requiredGates`. The caller supplies a JSON object through `--subject-file`; the engine strictly projects the gate's `subjectFields`, computes `subjectDigest` with JCS v1 deterministic serialization and SHA-256, and records a gate-policy digest. Callers cannot submit a raw digest.

审批对象示例：

Example approval subject:

```json
{
  "requirementBrief": "Build the approved frontend flow.",
  "sourceTrace": { "type": "local", "ref": "requirements/frontend.md" },
  "targetRepositories": ["operateBusiness"],
  "masterDesignPath": "docs/frontend-master-design.md",
  "repositoryDesignPaths": ["docs/operate-business-design.md"]
}
```

```bash
npm run loop -- gate approve \
  --loop frontend-delivery \
  --gate human-design-approval \
  --run-id run-001 \
  --task-id task-001 \
  --stage frontend-implementation \
  --subject-file /path/to/design-subject.json \
  --issuer wusheng \
  --evidence review:reports/design-review.md \
  --evidence human-approval:approval-record-001 \
  --json
```

`gate check` 可同时接收一个 stage 和多个 action，并检查两者所需 gate 的并集。检查结果只有 `passed` 才返回成功退出码；缺少通行证、run/task 不匹配、stage 不匹配、审批对象变化、gate 策略变化、审批人失去权限、过期、撤销、legacy pass 或损坏的 JSONL 事件都会 fail-closed。统一 `execute` runtime 会在调用 adapter 前强制执行同一检查，不依赖调用方自觉。

`gate check` may receive one stage and multiple actions, and checks the union of their required gates. Only a `passed` decision returns a successful exit code. A missing pass, run/task mismatch, stage mismatch, changed subject, changed gate policy, no-longer-authorized issuer, expiration, revocation, legacy pass, or malformed JSONL event fails closed. The unified `execute` runtime enforces the same check before invoking an adapter rather than relying on caller discipline.

```bash
npm run loop -- gate check \
  --loop frontend-delivery \
  --run-id run-001 \
  --task-id task-001 \
  --stage frontend-implementation \
  --subject-file /path/to/design-subject.json \
  --json

npm run loop -- gate check \
  --loop morning-triage \
  --run-id run-001 \
  --task-id task-001 \
  --action merge \
  --subject-file /path/to/merge-subject.json \
  --json
```

撤销不会改写或删除原始授权，而是追加同一 `passId` 的 `revoked` 事件。`gate list` 与 `gate check` 是只读命令；`gate approve` 与 `gate revoke` 是追加写命令。

Revocation never rewrites or deletes the original grant. It appends a `revoked` event with the same `passId`. `gate list` and `gate check` are read-only; `gate approve` and `gate revoke` append events.

```bash
npm run loop -- gate revoke \
  --loop frontend-delivery \
  --pass-id <pass-id> \
  --issuer wusheng \
  --reason "requirements changed" \
  --json
```

### Execution Runtime 与只读 Codex Adapter / Execution Runtime And Read-Only Codex Adapter

`execute` 是 workflow stage 和受保护 action 的统一执行入口。它先解析 dry-run 计划和依赖，再在引擎内计算审批对象摘要并执行 stage/action GateGuard；只有自动节点通过门禁后才会调用 adapter，adapter 返回的结构化 submission 还必须通过该节点配置的 Harness。执行状态会追加到 `<memoryRoot>/loops/<loop-id>/stage-events.jsonl`，不会改写历史 attempt。

`execute` is the unified execution entry point for workflow stages and protected actions. It resolves the dry-run plan and dependencies, computes approval-subject digests inside the engine, and applies the combined stage/action GateGuard. The adapter is invoked only after an automatic stage passes its gates, and the adapter's structured submission must then pass the stage's configured Harness. Execution state is appended to `<memoryRoot>/loops/<loop-id>/stage-events.jsonl` without rewriting earlier attempts.

```bash
npm run loop -- execute \
  --loop morning-triage \
  --run-id run-001 \
  --task-id task-001 \
  --stage triage-discovery \
  --subject-file /path/to/execution-subject.json \
  --json
```

首个真实 adapter 是 `codex-cli-read-only`。它使用显式工作目录、`--sandbox read-only`、JSON output schema、`--output-last-message`、ephemeral 会话和忽略用户配置模式。它只允许 `intake`、`review`、`verification` 等只读节点；coding、design、PR、merge、release 或任何请求 action broker 的执行会在启动 Codex 进程前返回 `unsupported_mutation_stage`。

The first real adapter is `codex-cli-read-only`. It uses an explicit working directory, `--sandbox read-only`, a JSON output schema, `--output-last-message`, an ephemeral session, and ignored user configuration. It permits only read-only kinds such as `intake`, `review`, and `verification`; coding, design, PR, merge, release, or any execution requiring an action broker returns `unsupported_mutation_stage` before a Codex process starts.

当前执行权威范围是 `local_single_executor`：run 级本机锁能阻止同一台机器上的并发 writer，但不是跨机器 lease，也不能把同步 JSONL 当作分布式权威。Dashboard 只读投影这些事件，不参与执行、审批或锁管理。

The current authority scope is `local_single_executor`: a run-scoped local lock prevents concurrent writers on one machine, but it is not a cross-machine lease and synchronized JSONL is not a distributed authority. The Dashboard only projects these events; it does not execute work, grant approvals, or manage locks.

### Skill

入口文件：

```text
SKILL.md
workspace/projects/app-a/.loop/skills/triage.SKILL.md
```

根目录 `SKILL.md` 是仓级实现 Skill，用于代码实现阶段，要求编码前思考、简洁优先、精准修改和目标驱动验证。项目级 Skill 与 discovery Skill 负责补充项目背景和任务发现规则。当前 triage skill 会按 CI 失败、open issue、最近 commit、memory 记录筛选值得处理的 finding。

The root `SKILL.md` is the repository-level implementation Skill for coding phases. It requires thinking before coding, simplicity, surgical changes, and goal-driven verification. Project-level Skills and discovery Skills add project context and task discovery rules. The current triage skill selects findings from CI failures, open issues, recent commits, and memory records.

### Agent

入口文件：

```text
workspace/agents/generator.agent.yaml
workspace/agents/evaluator.agent.yaml
```

generator 负责产出，evaluator 负责独立说“不”。当前工程明确禁止 generator 自评：

```yaml
allowSelfReview: false
```

### Memory

入口目录：

```text
workspace/memory/loops/morning-triage/
```

Memory 是磁盘状态，不是上下文窗口。它用于跨轮保存状态、人工 inbox、决策、运行日志、finding 和指标。

### Obsidian Memory

推荐把本机 `workspace/workspace.local.yaml` 指向 Obsidian 中的项目独立目录：

```yaml
memoryRoot: /path/to/ObsidianVault/88-学习/10-项目记忆/xbaiProjectCode
```

目录协议：

```text
[vault]/88-学习/
  00-记忆索引/
    memory-index.json
    projects.md
    cases.md
    patterns.md
    tags.md
  10-项目记忆/
    xbaiProjectCode/
      index.md
      project-profile.md
      active-context.md
      decisions.md
      inbox.md
      loops/<loop-id>/
      cases/
      patterns/
      reports/
```

常用 memory 命令：

```bash
# 预览初始化，不写文件
npm run loop -- memory init --project xbaiProjectCode --json

# 写入缺失模板；已有文件默认不覆盖
npm run loop -- memory init --project xbaiProjectCode --write --json

# 生成全局索引
npm run loop -- memory index --write --json

# 校验协议、JSONL、索引 schema 和索引新鲜度
npm run loop -- memory validate --json

# 健康诊断，不修改文件
npm run loop -- memory doctor --json

# 跨项目检索
npm run loop -- memory search "Loop Engineering" --json

# 生成 loop 可用的上下文包
npm run loop -- memory context --loop morning-triage --json

# 预览/写入 case
npm run loop -- memory capture case --title "Auth Triage Lesson" --json
npm run loop -- memory capture case --title "Auth Triage Lesson" --write --json

# 预览/写入工作 checkpoint；body 必须是中英双语 Markdown
# Preview/write a work checkpoint; body must be bilingual Markdown
npm run loop -- memory checkpoint --title "工作摘要 / Work summary" --body /path/to/bilingual-summary.md --json
npm run loop -- memory checkpoint --title "工作摘要 / Work summary" --body /path/to/bilingual-summary.md --write --json

# 晋升 pattern，必须显式确认
npm run loop -- memory promote --case <case-path> --confirm --json

# 预览/写入健康报告
npm run loop -- memory report --json
npm run loop -- memory report --write --json
```

写入安全：

- `init`、`index`、`capture case`、`report` 默认 preview，必须 `--write` 才写入。
- `checkpoint` 默认 preview，必须提供 `--body`，并使用 `--write` 才会写入 case、当日快照和索引。
- 两台电脑可以使用不同的绝对 vault 路径；每台电脑只维护各自 ignored 的 `workspace/workspace.local.yaml`，不要互相复制绝对路径。
- `promote` 默认 preview，必须 `--confirm` 才写入。
- 当前版本不提供删除、清理、去重命令。
- `.jsonl` 是机器日志，不建议人工编辑。
- `memory-index.json` 可随时通过 `memory index --write` 重新生成。

- `init`, `index`, `capture case`, and `report` use preview mode by default and require `--write` to persist changes.
- `checkpoint` uses preview mode by default, requires `--body`, and writes the case, daily snapshot, and index only with `--write`.
- Two computers may use different absolute vault paths. Each computer must maintain its own ignored `workspace/workspace.local.yaml`; do not copy absolute paths between machines.
- `promote` uses preview mode by default and requires `--confirm` to write.
- The current version provides no delete, cleanup, or deduplication command.
- `.jsonl` files are machine logs and should not be edited manually.
- `memory-index.json` can always be rebuilt with `memory index --write`.

## 当前 dry-run 会做什么

执行：

```bash
npm run dry-run
```

当前会从 mock connector 中发现 3 个 finding：

- `task-001`: Auth tests failing on main
- `task-002`: Checkout test flaky
- `task-003`: Checkout returns 500 for expired sessions

并为每个 finding 生成：

- 独立 task id
- 独立 branch 名
- 独立 worktree 路径
- generator run plan
- evaluator review plan
- memory 写回计划

## 全过程模拟

执行：

```bash
npm run simulate
```

该命令会在本地确定性模拟一轮完整 Loop 生命周期，不调用外部 API，不创建真实 PR，不发送真实通知。

模拟阶段：

```text
1. 初始化 Loop 工作空间
2. 接入代码仓与项目知识
3. 发现可处理事项
4. 隔离交付计划
5. 生成者与评审者模拟
6. 知识沉淀
```

模拟会写出这些产物：

```text
workspace/reports/simulations/<run-id>.md       # 全过程模拟报告
workspace/memory/loops/morning-triage/state.md # 更新后的 loop 状态
workspace/memory/loops/morning-triage/runs.jsonl
workspace/memory/loops/morning-triage/findings.jsonl
workspace/memory/loops/morning-triage/metrics.jsonl
data/cases/<date>-loop-simulation-lifecycle.md # 团队成长 case
data/index/cases-index.json                    # case 机器索引
data/index/patterns-index.md                   # pattern 人工索引
Obsidian project cases/                         # 如果 memoryRoot 指向 Obsidian 项目目录，同步写入项目 case
Obsidian 00-记忆索引/memory-index.json          # 同步刷新索引
```

## 维护约定

- 新增 loop：在 `workspace/loops/` 增加 `*.loop.yaml`，并补齐对应 skill、memory、connector、agent 引用。
- 新增配置类型：先补 `loop-engineering/schemas/`，再补 `shared/src/types.ts` 和校验逻辑。
- 新增 runtime 能力：优先在 `loop-engineering/packages/<责任名>/` 下扩展，不把逻辑塞进 CLI。
- 新增或评审前端工程能力：遵守 `loop-engineering/docs/frontend-platform-standards.md`。 / For new or reviewed frontend engineering work, follow `loop-engineering/docs/frontend-platform-standards.md`.
- 新增、澄清或评审产品需求：遵守 `loop-engineering/docs/product-requirement-platform-standards.md`。 / For new, clarified, or reviewed product requirements, follow `loop-engineering/docs/product-requirement-platform-standards.md`.
- 进入代码实现阶段：先遵守根目录 `SKILL.md`，再叠加项目级 `SKILL.md`。 / During code implementation phases, follow the root `SKILL.md` first, then layer on the project-level `SKILL.md`.
- 修改 workspace 配置后：`npm run validate` 是提交或合并前门禁，agent 需先询问用户是否执行。 / After changing workspace configuration, `npm run validate` is a pre-commit or pre-merge gate; agents must ask the user before running it.
- 修改 runtime 代码后：`npm test` 是提交或合并前门禁，agent 需先询问用户是否执行。 / After changing runtime code, `npm test` is a pre-commit or pre-merge gate; agents must ask the user before running it.
- 修改 Obsidian memory 协议或 CLI 后：`npm test` 与 `npm run loop -- memory validate --json` 需按风险选择验证，其中 `npm test` 需先询问用户是否执行。 / After changing the Obsidian memory protocol or CLI, choose verification based on risk with `npm test` and `npm run loop -- memory validate --json`; ask the user before running `npm test`.

## 当前边界 / Current Boundaries

当前工程保留以下边界：

The current system retains these boundaries:

- 只有符合条件的只读节点可以通过本机 Codex CLI 调用 LLM；写节点在 adapter 启动前阻断。
- Only eligible read-only stages can call an LLM through the local Codex CLI; mutation stages are blocked before adapter startup.
- 不实际创建 git worktree、GitHub PR，也不执行 merge 或 release。
- It does not create Git worktrees or GitHub pull requests, and it does not perform merges or releases.
- 不实际发送 Slack/Jira 请求；connector 数据仍来自 YAML 中的 `mock` 字段。
- It does not send Slack or Jira requests; connector data still comes from YAML `mock` fields.
- GatePass 和 StageEvent 使用本机追加式 JSONL；当前没有跨机器 lease 或分布式权威存储。
- GatePasses and StageEvents use local append-only JSONL; no cross-machine lease or distributed authority store exists yet.

后续接入写能力时，应优先新增 engine-owned action broker，并替换 connector-runtime、agent-runtime、worktree-manager 的具体实现，而不是绕过 Gate/Harness 或改变 loop spec 的核心结构。

Future mutation support should add an engine-owned action broker and replace concrete connector-runtime, agent-runtime, and worktree-manager implementations instead of bypassing Gate/Harness enforcement or changing the core loop-spec structure.
