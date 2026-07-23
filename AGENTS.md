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

### English

1. Preserve existing directory boundaries and keep local workspace state out of engine code.
2. Prefer structured YAML/JSON schema configuration over ad hoc string conventions.
3. When changing loop, agent, connector, or budget configuration, update schema validation and tests when needed.
4. When changing memory read/write behavior, confirm dry-run, validate, and simulate resolve paths consistently.
5. Do not use generator self-review as a completion gate; reviews should be performed by an independent evaluator.
6. When adding or reviewing frontend engineering capabilities, follow `loop-engineering/docs/frontend-platform-standards.md`.
7. During code implementation phases, follow the root `SKILL.md` first, then layer on the project-level `workspace/projects/<project>/SKILL.md`.
8. When adding, clarifying, or reviewing product requirements, follow `loop-engineering/docs/product-requirement-platform-standards.md`.
