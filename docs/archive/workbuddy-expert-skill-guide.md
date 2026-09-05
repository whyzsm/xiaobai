# WorkBuddy 专家包与技能创建规则指南

# WorkBuddy Expert-Package & Skill Creation Rules Guide

> 本文档整理自 WorkBuddy 内置 `expert-manager`(专家包管理)与 `skill-creator`(技能创建)两项技能,覆盖"专家中心"专家/专家团与"技能"两类扩展机制的创建规则。
>
> This guide consolidates the creation rules for two WorkBuddy extension mechanisms — Expert Packages (Expert / Expert Team in the Expert Center) and Skills — drawn from the built-in `expert-manager` and `skill-creator` skills.

---

## 0. 概览 / Overview

WorkBuddy 有两种"把能力固化下来"的机制,规则互不相同:

WorkBuddy offers two distinct mechanisms for packaging capabilities, each with its own ruleset:

- **专家包(Expert Package)**:在左侧栏**专家中心(Expert Center)**上架,分 `agent`(专家)与 `team`(专家团)两类,靠 `expert-manager` 脚本校验注册。
  - *Expert Package*: listed in the left-sidebar **Expert Center**; two kinds — `agent` (single expert) and `team` (expert group); validated and registered via `expert-manager` scripts.
- **技能(Skill)**:模块化自包含包,通过 `skill-creator` 的 `init_skill.py` 起骨架、`package_skill.py` 打包。
  - *Skill*: a modular self-contained package; scaffolded with `init_skill.py` and packaged with `package_skill.py`.

> 注意:本仓库 Loop Engineering 框架里也有"agent / loop"概念,但那是另一套(基于 YAML schema 的引擎层),**不等于**专家中心专家包。两套不要混用。
> Note: this repo's Loop Engineering framework also has "agent / loop" concepts, but that is a separate engine-layer mechanism based on YAML schemas — **distinct from** Expert Center packages. Do not conflate the two.

---

# 第一部分:专家包(专家 / 专家团)

# Part 1: Expert Packages (Expert / Expert Team)

## 1.1 判定:专家 vs 专家团 / Determine: Expert vs Expert Team

- **单角色** → `expertType: "agent"`,展示为"专家"。
  - *Single role* → `expertType: "agent"`, shown as "专家" (Expert).
- **多角色协作** → `expertType: "team"`,展示为"专家团"。
  - *Multi-role collaboration* → `expertType: "team"`, shown as "专家团" (Expert Team).
- 类型**不可随意指定**,必须按实际结构判断;修改类型须遵守展示字段变更规则。
  - Type **must not be arbitrarily assigned** — judge by actual structure; changing type must follow the display-field change rules.

## 1.2 固定目录(铁律)/ Fixed Directory (Hard Rule)

专家只能生成到:

Experts must be generated only into:

```
$WORKBUDDY_CONFIG_DIR/plugins/marketplaces/my-experts/plugins
```

未设置时默认 `~/.workbuddy/plugins/marketplaces/my-experts/plugins`。

Defaults to `~/.workbuddy/plugins/marketplaces/my-experts/plugins` when the env var is unset.

> **禁止**生成到其他目录——否则专家中心检测不到、无法使用。若用户要求换路径,必须拒绝并说明原因,仍使用专家目录。
> **Never** generate to other paths — the Expert Center will not detect it. If the user requests another path, refuse and explain, then continue in the expert directory.

## 1.3 七步标准流程 / Seven-Step Standard Flow

```
1. init_expert.py        初始化目录(带 [TODO] 占位符)
2. 填充内容              plugin.json + agents/*.md + 头像
3. ImageGen              生成头像
4. validate_expert.py    校验
5. register_expert.py    注册到 marketplace.json
6. package_expert.py     打包分享
7. 告知用户核对
```

```
1. init_expert.py        Initialize directory (with [TODO] placeholders)
2. Fill content          plugin.json + agents/*.md + avatars
3. ImageGen              Generate avatars
4. validate_expert.py    Validate
5. register_expert.py    Register into marketplace.json
6. package_expert.py     Package for sharing
7. Inform user to verify
```

注册使用固定 `--session-id c1f68e63-d00f-434f-be3d-b8a775dfcdc4`。
Registration uses the fixed `--session-id c1f68e63-d00f-434f-be3d-b8a775dfcdc4`.

## 1.4 plugin.json 规则(Team 专用)/ plugin.json Rules (Team-specific)

必填基础字段:`name`(kebab-case,也是技能命名空间前缀)、`version`(语义化)、`description`(英文一句)。
Required base fields: `name` (kebab-case, also the skill namespace prefix), `version` (semver), `description` (one English line).

Team 专用字段:

| 字段 | 规则 |
|------|------|
| `expertType` | `"team"` |
| `agentName` | **`{team}-team-lead`**(主理人 MD 文件名,不含 .md),必须有业务语义,禁用通用名 `team-lead` |
| `teamInfo` | `{leadAgent, memberAgents[]}` —— **memberAgents 不含主理人** |
| `agents` | 路径数组,含主理人 MD 与各团员 MD |
| `members[]` | 主理人也在内(`role:"lead"`),其他 `role:"member"` |

| Field | Rule |
|-------|------|
| `expertType` | `"team"` |
| `agentName` | **`{team}-team-lead`** (lead's MD filename, no .md), must be semantically meaningful; no generic `team-lead` |
| `teamInfo` | `{leadAgent, memberAgents[]}` — **memberAgents excludes the lead** |
| `agents` | path array including lead MD and each member MD |
| `members[]` | lead is included (`role:"lead"`), others `role:"member"` |

展示字段必填:`displayName / profession / displayDescription(中文 40–50 字) / avatar / categoryId / defaultInitPrompt / tags(固定 3 个) / quickPrompts(固定 3 个)`。
Required display fields: `displayName / profession / displayDescription (40–50 Chinese chars) / avatar / categoryId / defaultInitPrompt / tags (fixed 3) / quickPrompts (fixed 3)`.

> **Team 型 `profession` 须与 `displayName` 一致**(两者都是团队名)。`plugin` 字段值须等于 `name`。
> **For Team type, `profession` must equal `displayName`** (both are the team name). The `plugin` field value must equal `name`.

## 1.5 Agent MD 规范 / Agent MD Spec (`agent-md-spec.md`)

**Frontmatter 必填**:`name`(与文件名一致、有业务语义)、`description`(英文,用于激活判断)、`displayName{en,zh}`、`profession{en,zh}`、`maxTurns`(默认 50,主理人建议 150–200)。
**Required frontmatter**: `name` (matches filename, semantically meaningful), `description` (English, used for activation), `displayName{en,zh}`, `profession{en,zh}`, `maxTurns` (default 50; lead suggested 150–200).

⚠️ **frontmatter 禁止声明 `tools` 字段**——工具由系统统一分配。
⚠️ **Never declare a `tools` field in frontmatter** — tool permissions are assigned by the system.

可选字段:`skills: [{skill-name}]`(启动时预加载)。
Optional: `skills: [{skill-name}]` (preloaded at start).

正文结构(普通团员):`# 角色 - 人名` → 核心能力 / 工作流程 / 输出规范 / 注意事项。
Body structure (member): `# Role - Name` → Core Abilities / Workflow / Output Spec / Notes.

**主理人额外要求**:
**Lead-specific requirements:**

- 文件名必须带专家团前缀:`{team}-team-lead.md`,**禁用通用 `team-lead.md`**。
  - Filename must carry the team prefix: `{team}-team-lead.md`; **never the generic `team-lead.md`**.
- 正文含:团队成员表、SOP 工作流、协作铁律、预设 Workflow、单 agent 直调路由表、成员能力清单。
  - Body includes: member table, SOP workflow, collaboration rules, preset Workflows, single-agent routing table, member capability list.
- 团员 prompt 必备 6 段:角色定义 / 擅长领域 / 分析框架 / 数据获取方式 / 结构化输出模板 / **SendMessage 回传要求**。
  - Member prompt must contain 6 parts: role definition / strengths / analysis framework / data acquisition / structured output template / **SendMessage handback requirement**.

## 1.6 协作铁律 / Collaboration Iron Rules (`team-spec.md`)

**4 条正则 / 4 Principles:**

1. **建立团队**——只能主理人执行 TeamCreate,严禁委派成员。
   - *Establish team* — only the lead may run TeamCreate; never delegate.
2. **调度成员**——按 SOP 阶段 spawn 成员、下发独立任务,产出由成员自己写。
   - *Dispatch members* — spawn members per SOP phase with independent tasks; output written by members themselves.
3. **消息中转**——所有跨成员信息流**必须经主理人中转**,不得互相直连。
   - *Message relay* — all cross-member flows **must pass through the lead**; no direct member-to-member links.
4. **成员结论为准**——专业产出由对应成员输出后才采信,主理人只编排汇编。
   - *Member verdicts stand* — accept professional output only after the member produces it; lead only orchestrates/compiles.

**5 条红线 / 5 Red Lines:**

- ❌ 跳过 TeamCreate 自己模拟多角色发言
  - *Skip TeamCreate and fake multi-role speech*
- ❌ 代写任何成员的专业产出
  - *Write any member's professional output on their behalf*
- ❌ 未完成前序阶段就跳阶段
  - *Jump phases before prior phases complete*
- ❌ 成员互相直连通信
  - *Members communicate directly with each other*
- ❌ spawn 主理人自己
  - *Spawn the lead itself*

调度成员时,Agent 工具的 `name` 与 `subagent_type` 都传 **Agent ID(MD 文件名,不含 .md)**,禁止用中文名。
When dispatching, the Agent tool's `name` and `subagent_type` both take the **Agent ID (MD filename, no .md)** — never a Chinese name.

## 1.7 成员命名规范 / Member Naming Rules

`name`(谐音花名)规则:

Rules for the `name` (pun-based nickname):

- 建议三个字、姓+名结构、暗含职能巧思、中英文都自然;`nickname` 可选。
  - Prefer three characters, surname+given structure, subtle functional wordplay, natural in both languages; `nickname` optional.
- **禁止**:叠字谐音(领码码)、一字名/纯职能词、与 `profession` 重复、无意义随机名(张三/John Doe)、英文用 Agent ID、读起来是短语。
  - **Forbidden**: reduplicated puns, one-char / pure-function names, duplicates of `profession`, meaningless random names (张三/John Doe), English using Agent ID, phrase-like readings.
- 主理人 `profession` **不能用通用 title**(团长/主理人/Team Lead),要体现调度风格与业务定位。
  - Lead's `profession` **must not use generic titles** (团长/Lead/Team Lead); reflect dispatch style and business positioning.

示例(软件开发团队):交付总监 齐活林 / 架构师 高见远 / QA 严过关。
Example (dev team): Delivery Director 齐活林 / Architect 高见远 / QA 严过关.

## 1.8 展示字段硬约束 / Display Field Hard Constraints

- `tags` 固定 **3 个**;`quickPrompts` 固定 **3 个**;满 3 个必须提示替换/删除,禁止继续新增。
  - `tags` fixed at **3**; `quickPrompts` fixed at **3**; when full, prompt to replace/delete — never add more.
- 第 1 条 `quickPrompt` = `defaultInitPrompt`。
  - First `quickPrompt` = `defaultInitPrompt`.
- `displayDescription` 中文 **40–50 字**。
  - `displayDescription` **40–50 Chinese characters**.
- `categoryId` 从 12 个分类按核心能力选,**不可凭直觉,须说明理由**(见下表)。
  - `categoryId` chosen from 12 categories by core capability — **not by intuition; state the reason** (table below).

| categoryId | 分类 | Category |
|---|---|---|
| 01-ProductDesign | 产品设计 | Product Design |
| 02-Engineering | 技术工程 | Engineering |
| 03-GameSpatial | 游戏空间 | Game & Spatial |
| 04-DataAI | 数据智能 | Data & AI |
| 05-MarketingGrowth | 营销增长 | Marketing & Growth |
| 06-ContentCreative | 内容创作 | Content & Creative |
| 07-SalesCommerce | 销售商务 | Sales & Commerce |
| 08-FinanceInvestment | 金融投资 | Finance & Investment |
| 09-OperationsHR | 运营人力 | Operations & HR |
| 10-ProjectQuality | 项目质量 | Project & Quality |
| 11-SecurityCompliance | 法务安全 | Security & Compliance |
| 12-IndustryConsultant | 行业顾问 | Industry Consultant |

## 1.9 头像 / Avatars (`avatar-spec.md`)

| 项目 | 要求 |
|------|------|
| 格式 | PNG(推荐)或 JPG |
| 尺寸 | 512×512 px(正方形) |
| 大小 | 单张 ≤ 500KB |
| 风格 | 统一漫画/插画,专业自然 |
| 生成 | ImageGen,`size:"1024x1024"`(市场缩放为 512 展示) |

| Item | Requirement |
|------|-------------|
| Format | PNG (preferred) or JPG |
| Size | 512×512 px (square) |
| Weight | ≤ 500KB each |
| Style | Consistent cartoon/illustration, professional |
| Generation | ImageGen, `size:"1024x1024"` (scaled to 512 for display) |

- **Team 型**:N+1 张 = `team.png` + `{team}-team-lead.png` + 每个团员 `{member}.png`。
  - *Team type*: N+1 images = `team.png` + `{team}-team-lead.png` + one per member.
- prompt 必须从对应 MD 描述提取角色特征,不用通用模板硬编码;同一团队共用**风格锚定词**与背景色调(按 categoryId 映射)。
  - Prompts must extract character traits from each MD; share a **style anchor** and background tone (mapped by categoryId) across the team.
- 自动生成头像一个可手动替换(PNG/JPG、512×512、≤500KB)。
  - Auto-generated avatars may be manually replaced (PNG/JPG, 512×512, ≤500KB).

## 1.10 修改 / 批量 / 会话 / Edit / Batch / Session

- **严禁改**:`name` / `agentName` / 专家目录名 / `agents/` 下 MD 文件名——它们是唯一标识,改了专家会丢;改名只能重建。
  - **Never change**: `name` / `agentName` / expert directory name / MD filenames under `agents/` — they are unique identifiers; renaming requires recreation.
- 改完任何字段都必须**重新 register**。
  - After any field change, **re-register**.
- 批量创建:每个专家串行 `init → validate → register`,禁止只写文件跳过校验/注册。
  - Batch creation: each expert serially `init → validate → register`; never write files while skipping validation/registration.

---

# 第二部分:技能(Skill)

# Part 2: Skills

## 2.1 结构与必需文件 / Structure & Required File

```
skill-name/
├── SKILL.md          ← 必需(name + description + 正文)
├── scripts/          ← 确定性可执行代码
├── references/       ← 按需加载进上下文的文档
└── assets/           ← 输出中使用的文件(模板/图标/字体)
```

```
skill-name/
├── SKILL.md          ← required (name + description + body)
├── scripts/          ← deterministic executable code
├── references/       ← docs loaded into context as needed
└── assets/           ← files used in output (templates/icons/fonts)
```

SKILL.md 是唯一必需文件;scripts/references/assets 可选。
SKILL.md is the only required file; scripts/references/assets are optional.

## 2.2 SKILL.md 硬性规则 / SKILL.md Hard Rules

- frontmatter 必填 `name` 和 `description`。
  - frontmatter requires `name` and `description`.
- **agent 创建的技能必须含 `agent_created: true`**(否则 `skill_manage` 后续无法改/删)。
  - **Agent-created skills MUST include `agent_created: true`** (otherwise `skill_manage` cannot modify/delete later).
- `description` 用**第三人称**:"This skill should be used when…",写清**何时触发**。
  - `description` uses **third person**: "This skill should be used when…"; state **when to trigger**.
- 正文用**祈使/不定式**(动词开头,如 "To accomplish X, do Y"),不用第二人称。
  - Body uses **imperative/infinitive** (verb-first, e.g. "To accomplish X, do Y"), not second person.

## 2.3 资源分层(渐进式披露)/ Resource Layering (Progressive Disclosure)

| 层级 | 内容 | 加载时机 |
|------|------|----------|
| 元数据 | name + description | 常驻上下文(~100 词) |
| SKILL.md 正文 | 程序性指引 | 触发时(<5k 词) |
| 打包资源 | scripts/references/assets | 按需(无限*) |

| Tier | Content | Loaded when |
|------|---------|-------------|
| Metadata | name + description | always in context (~100 words) |
| SKILL.md body | procedural guidance | on trigger (<5k words) |
| Bundled resources | scripts/references/assets | as needed (unlimited*) |

\* scripts 可不经上下文直接执行。SKILL.md 保持精简;大文档(>10k 词)放 references/,并在 SKILL.md 给 grep 模式;信息只放一处,不重复。
\* scripts run without loading into context. Keep SKILL.md lean; large docs (>10k words) go in references/ with grep patterns in SKILL.md; never duplicate info across files.

## 2.4 创建流程 6 步 / Six-Step Creation

1. **理解**:用具体例子厘清功能与触发语(别一次问太多)。
   - *Understand*: clarify function and trigger phrases with concrete examples.
2. **规划**:逐个例子分析要哪些 scripts/references/assets。
   - *Plan*: analyze each example for needed scripts/references/assets.
3. **初始化**:`init_skill.py`(生成带 TODO 的模板)。
   - *Initialize*: `init_skill.py` (generates TODO template).
4. **编辑**:先填 resources,再写 SKILL.md,删掉不需要的示例文件。
   - *Edit*: fill resources first, then SKILL.md; delete unneeded examples.
5. **打包**:`package_skill.py`(先自动校验 → 打包成 zip)。
   - *Package*: `package_skill.py` (auto-validate → zip).
6. **迭代**:用真任务测试后再改。
   - *Iterate*: test on real tasks, then improve.

## 2.5 存储位置 / Storage Locations

| 类型 | 路径 | 范围 |
|------|------|------|
| 用户技能 | `~/.workbuddy/skills/skill-name/` | 跨所有项目(默认,优先) |
| 项目技能 | `.workbuddy/skills/skill-name/` | 团队共享(仓库内) |

| Type | Path | Scope |
|------|------|-------|
| User skill | `~/.workbuddy/skills/skill-name/` | all projects (default, preferred) |
| Project skill | `.workbuddy/skills/skill-name/` | shared with repo collaborators |

`init_skill.py <skill-name> [--path <dir>]`,省略 `--path` 默认建到用户作用域。
`init_skill.py <skill-name> [--path <dir>]`; omitting `--path` defaults to user scope.

## 2.6 脚本 / Scripts

`skill-creator/scripts/` 下提供:

Provided under `skill-creator/scripts/`:

- `init_skill.py <skill-name> [--path <dir>]` — 初始化骨架
  - scaffold a new skill
- `package_skill.py <path> [output-dir]` — 校验并打包成 zip
  - validate then package into a zip
- `quick_validate.py <path>` — 快速校验
  - quick validation

## 2.7 校验内容 / Validation

`package_skill.py` 自动校验:frontmatter 格式与必填字段 / 命名与目录结构 / `description` 完整度与质量 / 文件组织与资源引用。失败则报错退出,不打包。
`package_skill.py` auto-validates: frontmatter format & required fields / naming & directory structure / `description` completeness & quality / file organization & resource references. On failure it errors out without packaging.

## 2.8 编辑已装的市场技能 / Editing Installed Marketplace Skills

改完用户要求的内容后,把 `"userModified": true` 写回技能目录下的 `_skillhub_meta.json`(或 `_knot_meta.json`),防止市场自动更新覆盖。本地新建的技能(无 meta 文件)**跳过此步**。仅创建新技能时不标记。
After saving edits to an installed marketplace skill, write `"userModified": true` into its `_skillhub_meta.json` (or `_knot_meta.json`) to prevent marketplace auto-updates from overwriting. Locally created skills (no meta file) **skip this step**. Do not flag when creating brand-new skills.

---

# 第三部分:四份专家包参考文档速览

# Part 3: The Four Expert-Package Reference Docs

| 文件 | 定位 |
|------|------|
| `agent-md-spec.md` | 单个 Agent / 主理人 MD 的 frontmatter 与正文结构(⚠️ 禁 `tools`;主理人文件名须带前缀) |
| `team-spec.md` | Team 型专属:成员谐音花名命名、协作 4 正则 + 5 红线、SOP 编排、`settings.json` |
| `plugin-json-spec.md` | `plugin.json` 全部字段 + Agent / Team 两套模板(Team 的 `teamInfo`/`members` 规则) |
| `avatar-spec.md` | 头像规格(512×512、≤500KB)、从 MD 提取特征的 prompt 构建、团队风格统一与背景色调映射 |

| File | Purpose |
|------|---------|
| `agent-md-spec.md` | frontmatter & body structure for a single Agent / lead (⚠️ no `tools`; lead filename needs prefix) |
| `team-spec.md` | Team-only: pun-nickname naming, 4 principles + 5 red lines, SOP, `settings.json` |
| `plugin-json-spec.md` | all `plugin.json` fields + Agent/Team templates (Team `teamInfo`/`members` rules) |
| `avatar-spec.md` | avatar specs (512×512, ≤500KB), MD-derived prompt building, team style & tone mapping |

> 四份文件位于 `expert-manager` 技能目录下:`…/resources/builtin-skills/expert-manager/references/`
> The four files live under the `expert-manager` skill: `…/resources/builtin-skills/expert-manager/references/`

---

# 附录:两套机制对照 / Appendix: Two Mechanisms Compared

| 维度 | 专家包(专家团) | 技能 |
|------|----------------|------|
| 管理技能 | `expert-manager` | `skill-creator` |
| 核心文件 | `plugin.json` + `agents/*.md` | `SKILL.md`(+ 可选 resources) |
| 脚手架 | `init_expert.py` | `init_skill.py` |
| 校验/注册 | `validate_expert.py` → `register_expert.py` | `package_skill.py`(内嵌校验) |
| 入口 | 专家中心(左侧栏) | 按需触发(由 description 匹配) |
| 协作形态 | 主理人 + 多团员真实多 agent 协作 | 单 agent 加载知识/脚本/资产 |

| Dimension | Expert Package (Team) | Skill |
|-----------|-----------------------|-------|
| Manager skill | `expert-manager` | `skill-creator` |
| Core files | `plugin.json` + `agents/*.md` | `SKILL.md` (+ optional resources) |
| Scaffold | `init_expert.py` | `init_skill.py` |
| Validate/Register | `validate_expert.py` → `register_expert.py` | `package_skill.py` (embedded validation) |
| Entry point | Expert Center (left sidebar) | On-demand trigger (matched by description) |
| Collaboration | Lead + members, real multi-agent | Single agent loads knowledge/scripts/assets |
