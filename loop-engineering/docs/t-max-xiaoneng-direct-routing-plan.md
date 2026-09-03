# T-MAX 项目组小能直达路由与多 Agent 执行方案 / T-MAX Project Group Xiaoneng Direct Routing And Multi-Agent Execution Plan

## 1. 目标 / Objective

中文：

将 T-MAX 项目组下的任意登记代码仓库接入同一套小能执行链路。用户只提供目标仓库、页面目标和需求文档地址，系统自动识别所属 t-max 项目组，读取共享 xiaoneng 源码，按小能 Manifest 路由，通过 Trellis 调度多 Agent，并由 suagent 独立监督。

English:

Route every registered repository in the T-MAX project group through one Xiaoneng execution path. The user provides only the target repository, page goal, and requirement URL. The system resolves the t-max project group, loads shared Xiaoneng source, routes through the Manifest, coordinates Agents through Trellis, and uses suagent for independent supervision.

## 2. 最短用户话术 / Shortest User Request

中文：

```text
operateSupport「网点打卡」一级菜单下新增页面，需求文档：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/wgz74ddg6t4vrt1t
```

替换仓库名即可支持：KPIUI、max-console-ui、max-operate-monitor-ui、operateBusiness、operateSupport、dcm 和 scan。

English:

```text
Create a new page under the first-level menu "网点打卡" in operateSupport. Requirement document: https://itxuqiu.yuque.com/gzlcs4/nuv8wt/wgz74ddg6t4vrt1t
```

“直接执行”表示自动开始解析、加载、编排和执行；不表示绕过设计审批、权限边界、测试授权、提交授权或推送授权。

"Direct execution" means that routing, loading, coordination, and execution start automatically. It does not bypass design approval, authorization boundaries, test authorization, commit authorization, or push authorization.

## 3. 核心边界 / Core Boundaries

中文：

```text
projectScopeRepositories = 整个 t-max 项目组范围
targetRepositoryId        = 本次唯一写入仓库
backgroundId              = 共享 xiaoneng 背景
```

operateSupport 可以自动读取 t-max 的项目组元数据、仓库清单和共享小能规则，但不会因为读取了项目组范围就默认扫描或修改其他仓库。

默认行为：

```yaml
defaults:
  loadProjectGroup: true
  loadSharedBackground: true
  xiaonengRouting: manifest-only
  execution: trellis
  supervisor: suagent
  writeScope: targetRepository-only
  commit: false
  push: false
  build: false
  startServer: false
```

跨仓库修改必须显式声明 affectedRepositories，重新进行范围分析、权限确认和 Gate 检查。

English:

operateSupport may read T-MAX project-group metadata, the repository inventory, and shared Xiaoneng rules, but it must not scan or modify other repositories merely because the group scope was loaded. Cross-repository changes require an explicit affectedRepositories declaration and a new scope and authorization check.

## 4. 当前事实与缺口 / Current Facts And Gaps

中文：

当前 workspace/projects/t-max/.loop/project.yaml 已声明：

- kind 为 ProjectGroup，项目组 ID 为 t-max。
- 共享背景为 xiaoneng。
- 已登记 7 个仓库：KPIUI、max-console-ui、max-operate-monitor-ui、operateBusiness、operateSupport、dcm、scan。
- 代码仓库和小能背景通过 workspace/.local/t-max/mounts/ 访问。

小能源码通过 workspace/.local/t-max/mounts/background/xiaoneng/ 挂载访问，入口为 xiaoneng-agent/SKILL.md，机器路由真源为 harness/runtime/manifest.yaml。不需要安装到 $CODEX_HOME/skills/xiaoneng-agent/，也不需要调用 sync-xiaoneng-hosts.sh。

现有小白工程已经能根据仓库名解析项目组，但还需要补齐源码型小能上下文解析、执行桥、源码消费证据、Trellis worker 生命周期和独立监督闭环。

English:

The project configuration already declares the T-MAX ProjectGroup, its seven repositories, the shared Xiaoneng background, and the ignored mount layout. The Xiaoneng source is loaded directly from its mounted checkout; no Codex skill installation or host-sync script is required. The remaining work is source-backed context resolution, an execution bridge, source-consumption evidence, Trellis lifecycle handling, and independent supervision.

## 5. 统一任务输入 / Unified Task Input

中文：

TaskIntake 将自然语言规范化为结构化任务。仓库名是用户入口，但项目组和背景必须从配置反查，不能写死在自然语言解析器中。

```json
{
  "projectId": "t-max",
  "projectKind": "ProjectGroup",
  "projectScopeRepositories": [
    "KPIUI",
    "max-console-ui",
    "max-operate-monitor-ui",
    "operateBusiness",
    "operateSupport",
    "dcm",
    "scan"
  ],
  "targetRepositoryId": "operateSupport",
  "parentMenuName": "网点打卡",
  "intent": "page.create",
  "pageName": "网点打卡",
  "requirementUrl": "https://itxuqiu.yuque.com/...",
  "backgroundId": "xiaoneng",
  "requestedActions": ["read", "write"]
}
```

解析失败、仓库歧义或项目组任务未指定目标仓库时，任务必须停止，不得选择默认仓库。

English:

TaskIntake normalizes the natural-language request into a structured task. The project group and background are resolved from configuration rather than hardcoded in the parser. Parsing failures, repository ambiguity, and project-group write requests without a target repository stop the task.

## 6. 项目组路由实现 / Project-Group Routing

中文：

扩展 loop-engineering/packages/project-registry/，增加项目组级路由结果：

```ts
interface ProjectGroupRoute {
  projectId: string;
  projectKind: 'ProjectGroup';
  projectScopeRepositories: RepositoryRoute[];
  targetRepository: RepositoryRoute;
  background: BackgroundRoute;
  resolution: {
    source: 'explicit-repository' | 'cwd' | 'remote';
    target: string;
    matchedRepositoryId: string;
  };
}
```

路由必须满足：

1. 按 repository 的 id、name、localPathKey 和 remote 确定性匹配。
2. 别名冲突报错，不随机选择。
3. 未知仓库 fail-closed。
4. projectScopeRepositories 完整返回 project.yaml 登记的 7 个仓库。
5. targetRepository 只能有一个。
6. 只存在于本机 local.paths.yaml、未登记到 project.yaml 的路径不属于项目组范围。

English:

Extend loop-engineering/packages/project-registry/ to return the full project-group scope and one target repository. Match deterministically by repository ID, name, local path key, or remote; fail closed for unknown or ambiguous targets; and never treat a local-only path as a registered repository.

## 7. 小能源码上下文解析 / Xiaoneng Source Context Resolution

中文：

新增 loop-engineering/packages/skill-context-runtime/。解析顺序固定为：

```text
project.yaml background.mount
  -> realpath
  -> harness/runtime/manifest.yaml
  -> manifest.skillContext.entryPath
  -> xiaoneng-agent/SKILL.md
  -> manifest.executionModes[mode]
  -> ownerAgent
  -> ownerSkills
  -> Manifest 明确声明的 references
```

所有路径必须经过真实路径 containment 校验，符号链接解析后仍然必须位于小能 sourceRoot 内。

只允许读取 Manifest 选择结果。默认排除：

```text
**/*.generated.*
docs/**
openspec/**
reports/**
harness/runtime/knowledge-intake/**
.xiaoneng/tmp/**
.understand-anything/**
skills/*/data/cases/**
skills/*/data/patterns/**
```

排除规则只是读取安全边界，不能成为第二套路由真源；路由仍然只能由小能的 harness/runtime/manifest.yaml 决定。

English:

Add loop-engineering/packages/skill-context-runtime/. Resolve the mount, Manifest, entry, execution mode, owner Agent, owner Skills, and explicitly declared references in that order. Validate real-path containment after symlink resolution. Generated, historical, temporary, and candidate materials are excluded by default. These exclusions are safety boundaries, not a second routing authority.

## 8. skill-context 与消费证据 / Skill Context And Consumption Evidence

中文：

每次运行生成 skill-context.json：

```json
{
  "contractVersion": "1.0.0",
  "skillId": "xiaoneng-agent",
  "skillCommit": "runtime-calculated",
  "entryPath": "xiaoneng-agent/SKILL.md",
  "entryHash": "sha256:...",
  "manifestPath": "harness/runtime/manifest.yaml",
  "manifestDigest": "sha256:...",
  "executionMode": "PageImplementation",
  "ownerAgent": "watermelon-frontend-agent",
  "ownerSkills": ["fe-page-workflow"],
  "selectedReferences": [],
  "contextDigest": "sha256:..."
}
```

同时生成 source-consumption.json，记录实际读取的文件、SHA-256、读取目的、消费 Agent 和时间。缺少 Manifest、入口、owner Agent、owner Skill 或 digest 时，skill-context-completeness-gate 失败。

English:

Each run generates skill-context.json and source-consumption.json. The evidence records the actual Manifest, entry, Agent, Skill, references, hashes, purpose, consumer, and timestamps. Missing source identity or digest evidence fails skill-context-completeness-gate.

## 9. 执行模式 / Execution Modes

中文：

| 用户意图 | Manifest 模式 | 默认结果 |
| --- | --- | --- |
| 新增页面，接口未明确 | PageScaffold | 页面契约和骨架，接口未就绪时进入 waiting_for_api |
| 页面与接口字段已明确 | PageImplementation | 完成页面、路由、model、service 和页面接线 |
| 只接接口和数据层 | ApiWiring | 完成 contract、请求、model/state 和页面消费 |
| 明确要求真实联调 | ApiIntegration | 增加 request/response/state/refresh 证据 |
| 明确要求测试验收 | TestAcceptance | 进入 Mango 测试和验收 |
| 明确要求完整五阶段 | FullWorkflow | 从需求理解到复盘沉淀 |

如果需要把 page.create 等意图映射为机器规则，只能在小能自己的 Manifest 和 schema 中增加 taskRouting，不能在小白中复制映射。

English:

Use the Manifest-declared mode for scaffolding, implementation, API wiring, integration, testing, or the full workflow. If machine-readable intent mapping such as page.create is needed, add taskRouting only to the Xiaoneng Manifest and its schema.

## 10. Trellis 多 Agent 与 suagent / Trellis Multi-Agent And suagent

中文：

每个任务使用独立 channel：xiaoneng-tmax-<taskId>。

| Agent | 职责 | 写权限 |
| --- | --- | --- |
| xiaobai | 总编排、路由、上下文锁、状态机 | 运行时证据 |
| lemon-product-agent | 需求、范围、字段、验收标准 | 只读 |
| orange-architect-agent | 页面类型、组件、技术方案、结构门禁 | 只读 |
| watermelon-frontend-agent | 目标仓页面实现 | 仅目标仓 |
| mango-test-agent | 代码审查、测试、验收 | 只读 |
| cantaloupe-knowledge-agent | 完整流程下的复盘沉淀 | 按授权 |
| suagent | 独立检查和 Go/No-Go | 只读 |

Lemon、Orange、Mango 和 suagent 可以并行只读；Watermelon 是唯一代码写入 Agent；同一任务只能有一个 writer。使用现有 workspace/agents/suagent.agent.yaml，不再创建第二个同名配置。旧 channel 的事件不能作为新任务证据。

English:

Use an isolated Trellis channel per task. Lemon, Orange, Mango, and suagent may read in parallel; Watermelon is the only code writer; and a task has only one writer. Reuse the existing workspace/agents/suagent.agent.yaml; do not create a second supervisor definition. Events from an old channel cannot prove a new task.

示例：

```bash
trellis channel create xiaoneng-tmax-<taskId> --scope project --project xbaiProjectCode \
  --cwd <xbai-workspace-root>
trellis channel spawn xiaoneng-tmax-<taskId> --as watermelon-frontend-agent \
  --provider codex --sandbox workspace-write
trellis channel spawn xiaoneng-tmax-<taskId> --as suagent \
  --provider codex --sandbox read-only
```

## 11. 页面执行流程 / Page Execution Flow

中文：

```text
解析仓库、一级菜单、页面名和 Yuque URL
  -> 识别 t-max ProjectGroup
  -> 返回 7 个项目组仓库，锁定一个 targetRepository
  -> 检查目标仓库分支、HEAD 和 dirty 状态
  -> 加载共享 xiaoneng、Manifest 和入口 Skill
  -> 生成 task-context-lock 和 skill-context
  -> Lemon 产出需求 brief
  -> Orange 产出页面技术方案
  -> 独立设计评审和 human-design-approval
  -> Watermelon 只修改目标仓库
  -> 目标静态检查和 git diff --check
  -> Mango 独立审查
  -> suagent 独立 Go/No-Go
  -> 生成本地交付报告
```

Yuque 不可访问且没有用户提供可读内容时，停在需求门禁，不得根据标题或记忆猜测需求。接口未明确时不得编造真实 API。

English:

The workflow resolves the repository and project group, locks one target, loads the shared Xiaoneng source, produces requirement and design artifacts, waits for design approval, lets Watermelon modify only the target repository, runs static checks, and obtains independent Mango and suagent decisions. An inaccessible Yuque document or missing API evidence blocks the task instead of triggering guesses.

## 12. 门禁、权限与证据 / Gates, Authorization, And Evidence

中文：

必须设置：

```text
project-group-resolution-gate
target-repository-gate
background-mount-gate
manifest-schema-gate
skill-context-completeness-gate
source-consumption-gate
task-context-freshness-gate
authorization-scope-gate
component-availability-gate
page-structure-gate
human-design-approval
implementation-verification-gate
independent-suagent-review-gate
commit-gate
push-gate
```

每个任务至少生成：

```text
task-context-lock.json
skill-context.json
source-consumption.json
requirement-brief.json
source-trace.json
page-type-decision.json
page-contract.json
page-field-matrix.json
api-contract-lock.json
api-implementation-evidence.json
stage-events.jsonl
agent-runs.jsonl
gate-results.json
repo-diff.json
suagent-review.json
```

每个 workflow stage 记录 stageId、stageKind、owner、status、enteredAt、firstActionAt、exitedAt、durationMs、activeMs、waitingMs、waitingReason 和 evidence。没有真实采集的时间只能记录为 unmeasured。

English:

The listed routing, source, authorization, implementation, review, and delivery gates are mandatory. Each task stores context, source, requirement, page, API, stage, Agent, Gate, diff, and suagent evidence. Every stage records ownership, status, active time, waiting time, waiting reason, and evidence; missing timing is recorded as unmeasured.

## 13. 实施拆分 / Implementation Breakdown

中文：

建议拆成 6 个独立变更：

1. 项目组路由增强：扩展 project-registry，返回全量 scope 和唯一 target，补齐 7 个仓库测试。
2. 小能上下文运行时：新增 skill-context-runtime，实现 Manifest、schema、containment、digest 和白名单。
3. 任务锁与权限：实现 task-context-lock、目标仓写入校验和 stale 检查。
4. 执行事件与证据：实现 stage、Agent、Gate、源码消费和 diff 证据。
5. Trellis/suagent 接入：实现独立 channel、单 writer、多 reader 和只读监督。
6. Manifest 机器路由补齐：如有需要，只修改小能 Manifest 和 schema，增加 taskRouting。

English:

Implement six independently verifiable changes: project-group routing; source-backed skill context; task locking and authorization; execution and evidence events; Trellis and suagent integration; and, only when needed, machine-readable routing in the Xiaoneng Manifest and schema.

## 14. 验收矩阵 / Acceptance Matrix

中文：

分别以以下仓库作为 targetRepository 做路由测试：

```text
KPIUI
max-console-ui
max-operate-monitor-ui
operateBusiness
operateSupport
dcm
scan
```

每个用例必须证明：projectId=t-max；项目类型为 ProjectGroup；范围完整包含 7 个仓库；target 等于用户指定仓库；background 为 xiaoneng；Manifest 和入口 Skill 被真实读取；owner Agent 和 Skills 来自 Manifest；只允许目标仓写入；suagent 可以独立检查证据；未知、歧义、越界和未授权跨仓场景会阻断。

English:

Run routing tests with each of the seven repositories as targetRepository. Every case must prove the T-MAX project-group identity, complete seven-repository scope, exact target, shared Xiaoneng background, actual Manifest and entry consumption, Manifest-derived ownership, target-only writes, independent suagent evidence access, and fail-closed behavior for unknown, ambiguous, out-of-bounds, and unauthorized cross-repository cases.

## 15. 验证与交付边界 / Verification And Delivery Boundary

中文：

默认允许路由测试、Manifest/schema 校验、目标文件静态检查、git diff --check、源码消费校验和 suagent 独立审查。默认不执行开发服务、构建、完整测试、浏览器自动化、git commit 或 git push；这些动作必须在对应阶段获得明确授权。

业务代码只能出现在目标仓库自己的 Git 状态中；工程仓库不得提交外部源码、软链接、local.paths.yaml 或 workspace/.local/ 内容。保留 sync-xiaoneng-hosts.sh，新链路禁止调用它；删除它需要单独的删除任务和影响分析。

English:

The default boundary allows routing tests, Manifest/schema validation, target static checks, git diff --check, source-consumption validation, and independent suagent review. Development servers, builds, full tests, browser automation, commits, and pushes require explicit authorization. Business code remains in the target repository; the engineering repository must not contain external source, symlinks, local path files, or ignored mount contents. Keep sync-xiaoneng-hosts.sh; removal is a separate authorized deletion task.

## 16. 最终结果 / Final Result

中文：

落地后，用户只需要说：

```text
operateSupport「网点打卡」一级菜单下新增页面，需求文档：Yuque
```

系统自动完成：

```text
operateSupport
  -> t-max ProjectGroup
  -> t-max 全部仓库清单
  -> 共享 xiaoneng
  -> Manifest 唯一路由
  -> Trellis 多 Agent
  -> suagent 独立监督
  -> 仅修改 operateSupport
```

替换 operateSupport 即可适用于 T-MAX 项目组中的其他登记仓库，不需要为每个仓库创建新的路由、Agent 或 Skill。

English:

After implementation, the user only needs to provide the repository, page goal, and Yuque URL. The system resolves the T-MAX ProjectGroup, loads the shared Xiaoneng source, routes only through the Manifest, coordinates Trellis Agents, supervises with suagent, and writes only to the selected repository. Replacing operateSupport supports every other registered T-MAX repository without duplicating routing, Agent, or Skill stacks.
