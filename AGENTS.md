# AGENTS.md

## 项目定位 / Project Scope

### 中文

本仓库是 Loop Engineering 工程骨架，用于把 agent 工作流拆成可维护、可审计、可验证的系统能力。

核心边界：

- `loop-engineering/`：引擎层，包含 runtime、schema、CLI、模板和测试。
- `workspace/`：运行空间，包含 loop 配置、项目知识、agent、connector、memory、budget、报告和本机挂载配置模板。

### English

This repository is a Loop Engineering scaffold. It turns agent workflows into maintainable, auditable, and verifiable system capabilities.

Core boundaries:

- `loop-engineering/`: engine layer for runtimes, schemas, CLI, templates, and tests.
- `workspace/`: operating space for loop specs, project knowledge, agents, connectors, memory, budgets, reports, and local mount templates.

## OpenHands 分发运行 / OpenHands Distribution Runtime

### 中文

1. `deploy/openhands/` 是 OpenHands 分发和运行适配层；它不得复制或替代 `loop-engineering/` 的编排实现。
2. OpenHands 容器中的稳定路径为：小白 `/projects/xiaobai`（读写）、小能 `/opt/xiaoneng`（只读）、Obsidian Vault `/memory/obsidian`（读写）。
3. OpenHands 开始处理小白任务时，按以下顺序加载上下文：根 `AGENTS.md` -> `workspace/agents/xiaobai.orchestrator.agent.yaml` -> 命中的项目 `project.yaml` 与 `SKILL.md` -> `/opt/xiaoneng/xiaoneng-agent/SKILL.md` -> `/opt/xiaoneng/harness/runtime/manifest.yaml`。
4. `workspace/projects/t-max/.loop/project.yaml` 继续作为 `t-max -> xiaoneng` 项目背景映射真源。OpenHands 适配层只建立容器内背景入口，不另建路由配置，也不调用要求完整 T-MAX 业务仓挂载的本机 `npm run mount:tmax`。
5. OpenHands runtime 必须在独立的 ignored 工作副本中运行，不覆盖开发者本机的 `workspace/workspace.local.yaml`、T-MAX 挂载或 Obsidian 绝对路径。
6. 模型 Key、模型地址、OpenHands 会话密钥和个人 Vault 路径只能从未跟踪的 `deploy/openhands/.env` 或接收方环境读取；不得写入仓库、bundle、`versions.lock` 或文档示例值。
7. 小能在第一阶段是版本锁定的只读背景。不得从小白分发脚本修改、提交或推送小能，也不得把 T-MAX 业务仓源码打进默认分发包。
8. `deploy/openhands/package.sh` 只从干净且已提交的 Git 状态生成 bundle、校验和和 resolved `versions.lock`；输出只进入 ignored 的 `dist/`。

### English

1. `deploy/openhands/` is the OpenHands distribution and runtime adapter. It must not copy or replace orchestration implemented by `loop-engineering/`.
2. Stable container paths are `/projects/xiaobai` for the writable Xiaobai workspace, `/opt/xiaoneng` for the read-only Xiaoneng background, and `/memory/obsidian` for the writable Obsidian vault.
3. When OpenHands starts a Xiaobai task, load context in this order: root `AGENTS.md` -> `workspace/agents/xiaobai.orchestrator.agent.yaml` -> the matched project `project.yaml` and `SKILL.md` -> `/opt/xiaoneng/xiaoneng-agent/SKILL.md` -> `/opt/xiaoneng/harness/runtime/manifest.yaml`.
4. `workspace/projects/t-max/.loop/project.yaml` remains the source of truth for the `t-max -> xiaoneng` background mapping. The OpenHands adapter only creates the container background entry; it must not introduce a second routing configuration or call the local `npm run mount:tmax` flow that requires a complete T-MAX business-repository mount.
5. Run OpenHands in a separate ignored workspace copy. Do not overwrite a developer's local `workspace/workspace.local.yaml`, T-MAX mounts, or Obsidian absolute paths.
6. Model keys, model endpoints, OpenHands session secrets, and personal vault paths must come only from the untracked `deploy/openhands/.env` or the recipient environment. Never write them to the repository, bundles, `versions.lock`, or example values in documentation.
7. In phase one, Xiaoneng is a version-locked read-only background. Xiaobai distribution scripts must not modify, commit, or push Xiaoneng, and the default package must not include T-MAX business repository source.
8. `deploy/openhands/package.sh` only packages clean, committed Git state into bundles, checksums, and a resolved `versions.lock`; all output belongs under ignored `dist/`.

## 语言与文档规则 / Language And Documentation Rules

### 中文

1. 本项目的协作语言使用中文简体。
2. 所有新增或修改的 Markdown 文档必须使用中英双语对照编写。
3. 双语范围包括但不限于：
   - `README.md`
   - `AGENTS.md`
   - `SKILL.md`
   - `*.agent.md`
   - `workspace/projects/**` 下的项目说明
   - `loop-engineering/docs/**`
   - 其他面向人阅读的 `.md` 维护文档
4. 双语内容必须逐段或逐节对照：中文段落后紧跟对应英文段落，或使用明确的 `中文 / English` 对照小节。
5. 不允许只翻译标题而正文单语，也不允许把中文和英文拆成无法对应的两份文档。
6. 配置文件、代码注释、测试名称不强制双语；但如果注释用于解释业务约束或 agent 规则，优先双语。

### English

1. Use Simplified Chinese as the primary collaboration language for this project.
2. All new or modified Markdown documentation must use side-by-side Chinese-English bilingual structure.
3. This applies to, but is not limited to:
   - `README.md`
   - `AGENTS.md`
   - `SKILL.md`
   - `*.agent.md`
   - project documentation under `workspace/projects/**`
   - `loop-engineering/docs/**`
   - other human-facing `.md` maintenance documents
4. Bilingual content must be aligned paragraph by paragraph or section by section: place each Chinese paragraph next to its English equivalent, or use explicit `中文 / English` paired sections.
5. Do not translate only headings while leaving the body monolingual, and do not split Chinese and English into two documents that are hard to compare.
6. Config files, code comments, and test names do not have to be bilingual. If a comment explains business constraints or agent rules, prefer bilingual wording.

## 执行证据、安全与环境感知 / Execution Evidence, Safety, And Environment Awareness

### 中文

#### 反幻觉规则

1. 绝不在未实际读取文件的情况下声称已读取。
2. 绝不在未验证的情况下描述文件内容。
3. 绝不在没有执行证据的情况下报告任务完成。
4. 绝不在未实际调用的情况下假设工具输出。
5. 读取文件前先验证文件存在，例如运行 `ls -la path/to/file` 或等价命令。
6. 交付结论时展示或摘要实际命令输出作为证据。
7. 不确定时必须承认不确定，先说“我需要先确认...”而不是猜测。

#### 环境感知

1. 会话开始时识别当前执行上下文，例如本地开发、云开发、容器或远程运行环境。
2. 会话开始时识别当前可用工具、权限、网络和文件系统边界。
3. 在会话期间缓存工具可用性状态；如果工具、权限或上下文发生变化，重新确认后再行动。

#### 不可逆操作协议

执行创建、删除或批量操作之前：

1. 向用户展示完整的操作列表。
2. 清楚标记哪些操作不可逆。
3. 要求用户明确确认：“确认执行以上操作？(yes/no)”。
4. 对于超过 5 项的批量操作，分批执行，并在批次之间进行中间确认。

### English

#### Anti-Hallucination Rules

1. Never claim to have read a file without actually reading it.
2. Never describe file contents without verification.
3. Never report task completion without execution evidence.
4. Never assume tool output without an actual tool invocation.
5. Verify that a file exists before reading it, for example by running `ls -la path/to/file` or an equivalent command.
6. Show or summarize actual command output as evidence when delivering conclusions.
7. Admit uncertainty when facts are unclear; say "I need to confirm first..." instead of guessing.

#### Environment Awareness

1. Identify the current execution context at session start, such as local development, cloud development, container, or remote runtime.
2. Identify available tools, permissions, network access, and filesystem boundaries at session start.
3. Cache tool availability for the session; if tools, permissions, or context change, reconfirm before acting.

#### Irreversible Operation Protocol

Before executing create, delete, or batch operations:

1. Display the complete operation list to the user.
2. Clearly mark which operations are irreversible.
3. Require explicit user confirmation: "Confirm executing the operations above? (yes/no)".
4. For batch operations with more than 5 items, execute in batches with intermediate confirmations between batches.

## 本机状态与提交边界 / Local State And Commit Boundary

### 中文

1. 不要把本机路径、软链接生成物或外部代码仓内容提交到本工程仓。此限制只保护本工程仓的提交边界，不禁止 T-MAX 业务任务通过挂载入口修改目标仓的真实 worktree。
2. 已忽略的本机状态包括：
   - `workspace/.local/`
   - `workspace/workspace.local.yaml`
   - `workspace/projects/*/.loop/local.paths.yaml`
3. T-MAX 代码仓和 `xiaoneng` 背景只能通过 ignored 的 `workspace/.local/t-max/mounts/` 挂载访问。挂载由小白 workspace 统一解析和维护；小能不创建或维护另一套 T-MAX 挂载。
4. 如果需要刷新 T-MAX 挂载，运行：

```bash
npm run mount:tmax
```

5. 提交前运行：

```bash
git status --short -uall
```

确认本工程仓的列表里没有外部代码仓文件、没有 `workspace/.local/`、没有本机 `local.paths.yaml` 或 `workspace.local.yaml`。T-MAX 业务源码改动应出现在对应目标仓自己的 `git status` 中，并在该目标仓内独立管理。

### English

1. Do not commit machine-specific paths, generated symlinks, or external repository contents into this engineering repository. This protects only this repository's commit boundary; it does not prohibit a T-MAX business task from modifying a target repository's real worktree through its mount entry.
2. Ignored local state includes:
   - `workspace/.local/`
   - `workspace/workspace.local.yaml`
   - `workspace/projects/*/.loop/local.paths.yaml`
3. T-MAX repositories and the `xiaoneng` background must be accessed through ignored mounts under `workspace/.local/t-max/mounts/`. The Xiaobai workspace is the single owner of mount resolution and maintenance; Xiaoneng does not create or maintain a second T-MAX mount tree.
4. To refresh T-MAX mounts, run:

```bash
npm run mount:tmax
```

5. Before committing, run:

```bash
git status --short -uall
```

Ensure this engineering repository's output does not include external repository files, `workspace/.local/`, local `local.paths.yaml`, or `workspace.local.yaml`. T-MAX business source changes must appear in the corresponding target repository's own `git status` and be managed independently there.

## 新电脑或新项目初始化 / New Machine Or New Project Initialization

### 中文

新电脑 clone 本仓库后，先安装依赖：

```bash
npm install
```

如果需要使用 T-MAX 代码仓和 `xiaoneng` 背景，必须先创建本机路径配置：

```bash
cp workspace/projects/t-max/.loop/local.paths.yaml.example workspace/projects/t-max/.loop/local.paths.yaml
```

然后编辑 `workspace/projects/t-max/.loop/local.paths.yaml`，把 `xiaoneng` 和各 T-MAX 仓库路径改成这台电脑上的真实绝对路径。

编辑完成后运行：

```bash
npm run mount:tmax
```

这个命令会在 ignored 的 `workspace/.local/t-max/mounts/` 下生成软链接。没有这一步，agent 仍可读取工程配置，但无法通过统一挂载路径访问本机 T-MAX 仓库和 `xiaoneng` 背景。

如果接入新的项目组，也要沿用同样模式：提交项目级 `project.yaml`、`SKILL.md`、`local.paths.yaml.example` 和挂载脚本；不要提交本机 `local.paths.yaml`、`.local/` 软链接或外部代码仓内容。

### English

After cloning this repository on a new machine, install dependencies first:

```bash
npm install
```

If T-MAX repositories and the `xiaoneng` background are needed, create the local path configuration first:

```bash
cp workspace/projects/t-max/.loop/local.paths.yaml.example workspace/projects/t-max/.loop/local.paths.yaml
```

Then edit `workspace/projects/t-max/.loop/local.paths.yaml` and replace the `xiaoneng` and T-MAX repository paths with real absolute paths on that machine.

After editing, run:

```bash
npm run mount:tmax
```

This command generates symlinks under the ignored `workspace/.local/t-max/mounts/` directory. Without this step, agents can still read the engineering configuration, but they cannot access local T-MAX repositories or the `xiaoneng` background through the unified mount paths.

When adding a new project group, use the same pattern: commit the project-level `project.yaml`, `SKILL.md`, `local.paths.yaml.example`, and mount script; do not commit local `local.paths.yaml`, `.local/` symlinks, or external repository contents.

## Memory 与 Obsidian / Memory And Obsidian

### 中文

1. 默认 memory root 是 `workspace/memory`。
2. 每台电脑可用 ignored 的 `workspace/workspace.local.yaml` 改写 memory root；新电脑或新工程初始化时必须先复制 `workspace/workspace.local.yaml.example` 为 `workspace/workspace.local.yaml`，再改成本机真实路径。
3. 推荐把跨终端共享 memory 指向 Obsidian vault 下的同步目录，并显式声明 vault 根与学习根。例如当前 `xiaobai` 布局：

```yaml
memoryRoot: /absolute/path/to/ObsidianVault/88-学习/xiaobai/10-项目记忆/xbaiProjectCode
memoryVaultRoot: /absolute/path/to/ObsidianVault
memoryLearningRootName: 88-学习/xiaobai
```

4. `memoryRoot` 指向当前工程的项目记忆目录，`memoryVaultRoot` 指向 Obsidian vault 根目录，`memoryLearningRootName` 决定 `00-记忆索引` 与 `10-项目记忆` 的共同父级；例如上面的配置会使用 `88-学习/xiaobai/00-记忆索引`。
5. 如果 `memoryRoot` 已经位于 `88-学习/.../10-项目记忆/<projectId>` 下，系统会尽量自动推断 `memoryVaultRoot` 和 `memoryLearningRootName`；但跨电脑迁移时仍优先显式写出三个字段，避免路径歧义。
6. `state.md`、`inbox.md`、`decisions.md` 适合在 Obsidian 中人工维护。
7. `runs.jsonl`、`findings.jsonl`、`metrics.jsonl` 是机器追加日志；可以在 Obsidian 查看，但不建议手工编辑。
8. 完成有持久价值的任务后，agent 必须在最终回复前生成中英双语 Markdown 摘要，并执行 `npm run memory:checkpoint -- --title "<中文 / English>" --body <summary.md> --write --json`。
9. checkpoint 成功后必须执行 `npm run memory:audit-today -- --json`；如果审计失败，不得声称记忆已经持久化。纯问答、只读排查或没有形成可复用结论的任务可以不写 checkpoint，但最终回复要明确说明。

### English

1. The default memory root is `workspace/memory`.
2. Each computer can override the memory root with ignored `workspace/workspace.local.yaml`. When initializing a new computer or new project checkout, copy `workspace/workspace.local.yaml.example` to `workspace/workspace.local.yaml` first, then replace the paths with real local paths.
3. For cross-terminal memory sharing, point memory to a synced Obsidian vault directory and declare both the vault root and learning root explicitly. For the current `xiaobai` layout:

```yaml
memoryRoot: /absolute/path/to/ObsidianVault/88-学习/xiaobai/10-项目记忆/xbaiProjectCode
memoryVaultRoot: /absolute/path/to/ObsidianVault
memoryLearningRootName: 88-学习/xiaobai
```

4. `memoryRoot` points to this project's memory directory, `memoryVaultRoot` points to the Obsidian vault root, and `memoryLearningRootName` controls the shared parent of `00-记忆索引` and `10-项目记忆`; the example above uses `88-学习/xiaobai/00-记忆索引`.
5. If `memoryRoot` already lives under `88-学习/.../10-项目记忆/<projectId>`, the system will try to infer `memoryVaultRoot` and `memoryLearningRootName`; still prefer writing all three fields explicitly when moving across computers to avoid path ambiguity.
6. `state.md`, `inbox.md`, and `decisions.md` are suitable for manual maintenance in Obsidian.
7. `runs.jsonl`, `findings.jsonl`, and `metrics.jsonl` are append-only machine logs. They can be viewed in Obsidian, but manual edits are discouraged.
8. After completing work with durable value, the agent must create a bilingual Chinese-English Markdown summary and run `npm run memory:checkpoint -- --title "<Chinese / English>" --body <summary.md> --write --json` before the final response.
9. After a successful checkpoint, the agent must run `npm run memory:audit-today -- --json`. If the audit fails, the agent must not claim that memory was persisted. Pure Q&A, read-only diagnosis, or work without reusable conclusions may skip the checkpoint, but the final response must say so explicitly.

## 小改快路径与记忆豁免 / Micro Patch Fast Path And Memory Exemption

### 中文

当用户明确点名单个文件、单个字段、单个常量、单个删除或替换动作，并且现有实现路径已经明确、改动不会改变接口或数据来源时，例如“去掉写死的数据”“删除 `DEFAULT_xxx`”“只改这个文件”“把字段 A 换成字段 B”，必须进入小改快路径。

“字段改为走数据字典”“所有请求参数改为同一动态来源”“首次接入或改造接口数据来源”即使只涉及一个字段，也不属于小改快路径，必须路由到小能 `ApiIntegration.dictParam`。只有数据字典已经接入，后续仅删除硬编码、默认值或 fallback 时，才进入小改快路径。

小改快路径只读取目标文件和必要的直接引用；只做用户点名的最小改动；验证只限 `rg` 定位与回查、`git diff --check`，以及确有必要时的目标文件 lint 或语法检查。

小改快路径不得默认启动完整 loop、设计门禁、页面预检、组件全链路分析、业务构建、完整测试、memory checkpoint 或 `memory:audit-today`。如果执行中发现影响跨页面、schema、runtime、memory 规则或项目配置，先停止并说明扩大的原因，再等待用户确认。

单文件小改、去硬编码、替换字段名、删除一个默认值、只读排查和轻量验证默认不写 checkpoint。只有用户明确要求沉淀，或本次任务形成可复用规则、架构决定、跨页面复盘、工程配置变更时，才按上面的 Memory 规则写入 checkpoint 并审计。

### English

When the user names a single file, field, constant, deletion, or replacement, and the existing implementation path is already clear without changing an API or data source, such as "remove the hardcoded value", "delete `DEFAULT_xxx`", "only change this file", or "replace field A with field B", the agent must use the micro patch fast path.

A request to "make the field use a data dictionary", "make all request parameters use the same dynamic source", or introduce or change an API data source is not a micro patch even when only one field is involved. Route it to Xiaoneng `ApiIntegration.dictParam`. Use the micro patch fast path only for a follow-up that removes a hardcoded value, default, or fallback after the dictionary integration already exists.

The micro patch fast path reads only the target file and necessary direct references, applies only the smallest requested change, and verifies only with `rg` lookup/recheck, `git diff --check`, and target-file lint or syntax checks when genuinely useful.

The micro patch fast path must not start the full loop, design gates, page preflight, full component-chain analysis, business builds, full tests, memory checkpoint, or `memory:audit-today` by default. If the work turns out to affect another page, schema, runtime, memory rule, or project configuration, stop and explain the expanded impact before asking for user confirmation.

Single-file micro patches, hardcoded-value removals, field-name replacements, one-default deletions, read-only diagnosis, and lightweight verification do not create checkpoints by default. Only write and audit a checkpoint when the user explicitly asks for persistence, or when the task creates a reusable rule, architecture decision, cross-page retrospective, or engineering configuration change.

## 开发与验证命令 / Development And Verification Commands

### 中文

常用命令：

```bash
npm install
npm run validate
npm run dry-run
npm run simulate
npm test
```

修改 runtime、schema、memory、workspace 配置或脚本后，`npm run validate` 与 `npm test` 属于提交或合并前的人工确认门禁；agent 不得自行直接运行，必须先询问用户是否执行。

```bash
npm run validate
npm test
```

### English

Common commands:

```bash
npm install
npm run validate
npm run dry-run
npm run simulate
npm test
```

After changing runtime code, schemas, memory behavior, workspace configuration, or scripts, `npm run validate` and `npm test` are human-confirmed gates before commit or merge; agents must not run them directly without asking the user first.

```bash
npm run validate
npm test
```

## 小白评价工程体系 / Xiaobai Evaluation Engineering System

### 中文

评价小白时，必须把小白视为 Loop Engineering 工程系统，而不是单个 prompt、单个 agent 回复或一次最终文字输出。评价入口必须覆盖 `loop-engineering/` 引擎、`workspace/` 运行空间、loop spec、orchestrator、generator、harness、evaluator、human gate、memory、报告和 Git 交付闭环。

评价报告必须引用 `loop-engineering/docs/xiaobai-evaluation-engineering-system.md`，并至少说明：目标与路由是否明确、上下文是否来自真源、workflow 节点是否有输入输出和责任方、evaluator 与 human gate 是否真实生效、验证与远端交付是否有执行证据、失败是否能定位到具体节点。

评价报告必须包含 workflow 节点停留时间。每个节点至少记录或明确标记 `enteredAt`、`firstActionAt`、`exitedAt`、`durationMs`、`activeMs`、`waitingMs`、`waitingReason`、`status` 和 `evidence`。如果当前运行没有采集节点时间，不得估算或编造，必须把该节点标为 `unmeasured`，并将“缺少节点停留时间采集”列为工程可观测性问题。

节点停留时间要区分主动执行耗时与等待耗时。等待用户确认、工具运行、外部接口、缺少上下文、权限门禁和错误阻塞必须分别归因；不得把人工等待简单归咎为 agent 执行慢。

### English

When evaluating Xiaobai, treat it as a Loop Engineering system, not as a single prompt, one agent reply, or one final text output. The evaluation surface must cover the `loop-engineering/` engine, the `workspace/` operating space, loop specs, orchestrator, generator, harness, evaluator, human gates, memory, reports, and Git delivery closure.

Evaluation reports must reference `loop-engineering/docs/xiaobai-evaluation-engineering-system.md` and at least state whether the target and route are clear, whether context comes from sources of truth, whether workflow stages have inputs, outputs, and owners, whether evaluator and human gates are actually effective, whether validation and remote delivery have execution evidence, and whether failures can be traced to specific stages.

Evaluation reports must include workflow stage dwell time. Each stage must record, or explicitly mark, `enteredAt`, `firstActionAt`, `exitedAt`, `durationMs`, `activeMs`, `waitingMs`, `waitingReason`, `status`, and `evidence`. If the current run did not collect stage timing, do not estimate or fabricate it; mark that stage as `unmeasured` and list "missing stage dwell-time collection" as an engineering observability issue.

Stage dwell time must separate active execution time from waiting time. Waiting for user confirmation, tool execution, external APIs, missing context, permission gates, and error blockers must be attributed separately; do not collapse human waiting into "the agent was slow."

## 0.1 可见元素减法约束（强制） / 0.1 Visible Element Subtraction Constraints (Mandatory)

### 中文

新增任何可见元素前，必须回答“它帮助用户完成哪一步”；移除后不影响识别、决策、操作或防错的元素，不得加入。

1. 标题只出现一次：同一业务对象名称在一个视图内最多保留一个可见标题。左侧导航已经建立当前项目或迭代上下文时，主工作面不再重复面包屑、项目名、编码和解释性副标题。面包屑只用于真实的跨层返回，不作装饰。
2. 禁止默认套模板：不得默认复制“小标题 + 说明文 + 卡片 + 按钮”。页面结构由当前任务决定，不由组件模板决定。
3. 文案服务任务：只保留对象事实、操作结果、风险与防错信息；删除介绍页面用途、向评审解释功能或重复界面可见信息的文案。
4. 一个动作一个入口：同一视图内每个业务动作只保留一个主入口，并统一命名。除响应式常驻操作或已验证的高频流程外，不在顶栏、内容区和空状态重复放置同一动作。
5. 空状态给下一步：有可执行动作时直接说明下一步；没有动作时陈述业务结果。不得只写“暂无数据”，也不得在零条数据时渲染空表头和表格骨架。
6. 装饰默认不成立：卡片、圆角底块、阴影、渐变、图标、标签和分隔线均需承担分组、状态或操作语义；仅为“看起来完整”而添加时必须删除。
7. 强调有上限：一个视图只突出当前对象、当前任务和唯一主操作。辅助信息主动降级，禁止所有区块使用相同视觉重量。
8. 选中表达不叠加：常规导航、树节点和列表禁止使用左侧或右侧色条、内嵌阴影或完整描边表达选中；同一连续导航分支只允许最深层当前节点使用选中浅色，父级上下文仅用文字或图标强调。选中底色与侧边指示线同时出现属于设计阻断项。
9. 业务对象必须产品化：页面围绕对象生命周期和用户决策组织，而不是围绕字段表单组织。例如“项目成员”应表达访问范围、角色、状态和邀请生命周期，而不是一个 `members` 表单。

### English

Before adding any visible element, answer "Which user step does this help complete?" Do not add elements that can be removed without affecting recognition, decision-making, action, or error prevention.

1. Titles appear only once: keep at most one visible title for the same business object in a view. When the left navigation already establishes the current project or iteration context, the main workspace must not repeat breadcrumbs, project names, codes, or explanatory subtitles. Breadcrumbs are only for real cross-level navigation, not decoration.
2. Do not apply templates by default: do not default to copying "subtitle + description + card + button". Page structure is determined by the current task, not by a component template.
3. Copy serves the task: keep only object facts, operation results, risks, and error-prevention information; remove copy that introduces the page purpose, explains functionality to reviewers, or repeats visible interface information.
4. One action, one entry point: within the same view, keep one primary entry point for each business action and use one consistent name. Except for responsive persistent actions or verified high-frequency flows, do not repeat the same action in the top bar, content area, and empty state.
5. Empty states provide the next step: when an executable action exists, state the next step directly; when no action exists, state the business result. Do not only write "No data", and do not render empty table headers or table skeletons when there are zero records.
6. Decoration is not assumed: cards, rounded background blocks, shadows, gradients, icons, tags, and dividers must carry grouping, status, or action semantics; remove anything added only to make the page "look complete".
7. Emphasis has a limit: one view may emphasize only the current object, current task, and single primary action. Downgrade auxiliary information deliberately, and do not give every section the same visual weight.
8. Selection states must not stack: regular navigation, tree nodes, and lists must not use left or right color bars, inset shadows, or full outlines to express selection. In one continuous navigation branch, only the deepest current node may use a selected light background; parent context should be emphasized only with text or icons. Showing selected background and side indicator line at the same time is a design blocker.
9. Business objects must be productized: organize pages around object lifecycle and user decisions, not around field forms. For example, "Project members" should express access scope, roles, status, and invitation lifecycle, not a `members` form.

## 工程约束 / Engineering Constraints

### 中文

1. 优先保持现有目录边界，不把 workspace 本机状态混入 engine 代码。
2. 结构化配置优先使用 YAML/JSON schema，不用临时字符串约定替代。
3. 修改 loop、agent、connector、budget 配置时，要同步考虑 schema 校验和测试。
4. 修改 memory 读写逻辑时，要确认 dry-run、validate、simulate 的路径解析一致。
5. 不要把 generator 自评作为完成条件；评审应由独立 evaluator 执行。
6. 新增或评审前端工程能力时，遵守 `loop-engineering/docs/frontend-platform-standards.md`。
7. 进入代码实现阶段时，先遵守根目录 `SKILL.md`，再叠加项目级 `workspace/projects/<project>/SKILL.md`。
8. 新增、澄清或评审产品需求时，遵守 `loop-engineering/docs/product-requirement-platform-standards.md`。
9. 评价小白自身能力时，遵守 `loop-engineering/docs/xiaobai-evaluation-engineering-system.md`，并把节点停留时间作为必填评价维度。

### English

1. Preserve existing directory boundaries and keep local workspace state out of engine code.
2. Prefer structured YAML/JSON schema configuration over ad hoc string conventions.
3. When changing loop, agent, connector, or budget configuration, update schema validation and tests when needed.
4. When changing memory read/write behavior, confirm dry-run, validate, and simulate resolve paths consistently.
5. Do not use generator self-review as a completion gate; reviews should be performed by an independent evaluator.
6. When adding or reviewing frontend engineering capabilities, follow `loop-engineering/docs/frontend-platform-standards.md`.
7. During code implementation phases, follow the root `SKILL.md` first, then layer on the project-level `workspace/projects/<project>/SKILL.md`.
8. When adding, clarifying, or reviewing product requirements, follow `loop-engineering/docs/product-requirement-platform-standards.md`.
9. When evaluating Xiaobai's own capability, follow `loop-engineering/docs/xiaobai-evaluation-engineering-system.md` and treat stage dwell time as a required evaluation dimension.
