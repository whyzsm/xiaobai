# Loop Engineering 工程说明

本工程按共享对话里的《Loop Engineering 橙皮书》思路搭建，目标不是做一个单次 agent runner，而是把“发现、交付、验证、持久化、调度”拆成可维护、可审计、可扩展的工程系统。

核心边界：

```text
loop-engineering/ = 引擎层，放 runtime、schema、模板、CLI、测试
workspace/        = 运行空间，放 loop 配置、项目知识、agent、connector、memory、worktree、budget
```

当前版本是最小可运行骨架：不会真正调用 LLM，也不会真正创建 PR；它会读取 workspace 里的配置和 mock connector 数据，生成一次 loop dry-run 计划，用来验证目录、配置、职责边界是否成立。

## 快速开始

```bash
npm install
npm run validate
npm run dry-run
npm run simulate
npm test
```

常用命令：

```bash
# 校验 loop spec、schema、引用文件
npm run validate

# 生成一次 dry-run 计划，输出 JSON
npm run dry-run

# 指定 loop，输出人类可读计划
npm run loop -- dry-run --loop morning-triage

# 模拟从初始化、代码仓接入、任务处理到知识沉淀的全过程
npm run simulate

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
├── loop-engineering/                    # Loop Engineering 引擎层
│   ├── cli/
│   │   └── loop.ts                      # CLI 入口，支持 validate / dry-run
│   ├── docs/
│   │   └── architecture.md              # 架构说明
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
│   │   ├── budget-guard/                # token、重试、并发等预算检查
│   │   ├── human-gate/                  # 人工复核点配置
│   │   └── shared/                      # 公共类型、文件读取、schema 校验
│   ├── schemas/                         # JSON Schema，校验配置文件结构
│   │   ├── loop.schema.json
│   │   ├── harness.schema.json
│   │   ├── agent.schema.json
│   │   ├── connector.schema.json
│   │   └── budget.schema.json
│   ├── templates/                       # 可复制的配置模板
│   │   ├── triage.loop.yaml
│   │   ├── fix-bug.loop.yaml
│   │   ├── evaluator.agent.yaml
│   │   └── project.SKILL.md
│   └── tests/
│       └── runtime.test.ts              # 校验 workspace 与 dry-run 计划
└── workspace/                           # Loop 运行空间
    ├── loops/
    │   └── morning-triage.loop.yaml     # 当前示例 loop spec，系统核心配置
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

### Skill

入口文件：

```text
workspace/projects/app-a/.loop/skills/triage.SKILL.md
```

Skill 不是一整墙 prompt，而是可维护的项目知识和决策规则。当前 triage skill 会按 CI 失败、open issue、最近 commit、memory 记录筛选值得处理的 finding。

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
```

## 维护约定

- 新增 loop：在 `workspace/loops/` 增加 `*.loop.yaml`，并补齐对应 skill、memory、connector、agent 引用。
- 新增配置类型：先补 `loop-engineering/schemas/`，再补 `shared/src/types.ts` 和校验逻辑。
- 新增 runtime 能力：优先在 `loop-engineering/packages/<责任名>/` 下扩展，不把逻辑塞进 CLI。
- 修改 workspace 配置后：先跑 `npm run validate`。
- 修改 runtime 代码后：跑 `npm test`。

## 当前边界

当前工程只实现确定性骨架：

- 不实际调用 LLM
- 不实际创建 git worktree
- 不实际创建 GitHub PR
- 不实际发送 Slack/Jira 请求
- connector 数据来自 YAML 中的 `mock` 字段

后续接入真实能力时，应优先替换 connector-runtime、agent-runtime、worktree-manager 的具体实现，而不是改变 loop spec 的核心结构。
