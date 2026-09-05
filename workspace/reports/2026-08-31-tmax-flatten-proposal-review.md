# T-MAX 扁平化混合方案评估报告 / T-MAX Flattening Proposal Review

日期 / Date: 2026-08-31
评估对象 / Subject: 「8 个项目按 Harmony 方式成为顶层独立项目，t-max 降级为 catalog」混合落地方案
评估基线 / Baseline: `dsh-0829` @ `cb89d93`（工作区干净）

---

## 一、结论 / Conclusion

方案的架构方向正确，但规模与风险不匹配。

The direction is right; the scale is not.

决定性事实：被迁移的嵌套结构由 `e696a9f`（2026-08-31）一次性引入，存活数小时，且新引擎从未执行过任何 loop，`workspace/.loop/` 不存在，Obsidian memory root 下 139 条 checkpoint 的 `projectId` 全部为 `xbaiProjectCode`，无一条绑定到 `tmax-*`。因此方案中「避免 Memory、Gate、Run 和历史 Artifact 重新迁移」「保留当前已经完成的隔离」这两条核心前提不成立——**迁移成本为零，隔离尚未被验证**。

Recommendation: 不执行五阶段迁移。先让现有嵌套结构跑通一次真实 loop，再按第二节的最小增量做取舍。

---

## 二、决定性证据 / Decisive Evidence

| 项 / Item | 观测 / Observation | 来源 / Source |
|---|---|---|
| 嵌套结构引入时间 | 8 个子项目全部由 `e696a9f` 一次提交引入，2026-08-31 | `git log --diff-filter=A -- workspace/projects/t-max/projects/` |
| 引擎执行记录 | `workspace/.loop/` 与仓库根 `.loop/` 均不存在，零 artifact | `ls -d workspace/.loop` |
| 历史 run 归属 | 139 条 checkpoint 全部 `projectId: xbaiProjectCode` | `checkpoints.jsonl` 解析 |
| Memory 隔离现状 | memoryRoot 下为扁平 `cases/`、`loops/`，case frontmatter 为 `project: xbaiProjectCode` | Obsidian memoryRoot 实读 |
| 依赖组路由的 loop | `ane-standard-page` 与 `frontend-delivery` 均声明 `handoff.project: t-max` | `workspace/loops/*.loop.yaml` |
| 测试耦合面 | 约 80 处断言引用 `t-max`（`task-runtime` 19、`runtime` 12、`mcp-acp-server` 12、`client-submission` 11） | `loop-engineering/tests/*.test.ts` |

---

## 三、方案逐条对比 / Item-by-item Comparison

| 维度 | 现状 | 提案 | 是否真增量 |
|---|---|---|---|
| 顶层项目发现 | 扫描 `workspace/projects/*/.loop/project.yaml` | 同 | 否 |
| 单仓顶层项目 | `harmony-wardrobe`、`trunkFeeder` 已是「`kind: ProjectGroup` 且无 `children`」 | `role: standalone` | **否，`kind` 已足够** |
| 组不可执行 | 靠 `childProjectIds` 守卫 | 靠 `role: catalog` 守卫 | 是（但现状守卫会被提案破坏，见 4.1） |
| 共享小能背景 | 组 → 子目录继承 | 跨目录 `sharedContext` 引用 | **是，唯一核心增量** |
| `localPaths` 共用 | 子项目回落到组目录 | `localPathsRef: t-max` | 是 |
| Skill 继承 | `rebasePath` 目录内重定向 | `skillPolicy.inherit` | 是 |
| `catalog.projectIds` 清单 | 不存在 | 新增显式清单 | **否，冗余且与 `catalogId` 双写** |
| Memory 隔离 | `project:${id}/loop:${id}` 仅存在于 `ProjectContext`，物理落盘未分目录 | 按项目分目录 | 是，但属既有欠账 |
| 加载摘要化 | `loadProjectRegistry` 每次全量解析 YAML，无缓存 | 「只读配置摘要」+ digest 缓存 | 是，但方案未给实现路径 |

---

## 四、方案本身的七处硬伤 / Seven Defects

### 4.1 catalog 守卫依赖被删除的字段（回归）

`projectRegistry.ts:258 / 284 / 305 / 383` 与 `validation.ts:371` 判断「是不是组」全部依赖 `children` / `childProjectIds`。提案移除 `t-max` 的 `children` 后：

- `requireSingleMatch` 的组守卫（`childProjectIds.length > 0`）被跳过 → `t-max` 成为合法执行目标；
- `findRepositoryMatches` / `findRemoteMatches` / `findCwdMatches` 的 `if (entry.childProjectIds) continue` 全部失效 → `t-max` 可被仓库名、remote、cwd 命中。

必须新增一条不依赖 `children` 的 catalog 守卫，否则`t-max` 从「不可执行」变成「可执行且 `repositoryRoot` 解析到 mounts 根目录」。

### 4.2 共存期去重键会静默选错项目

`dedupeMatches`（`projectRegistry.ts:393-395`）的键是 `projectId:repositoryId:matchedPath`，**不含 `projectRoot`**。新旧两份配置 projectId 相同、matchedPath 相同 → 折叠为一条。而 `loadProjectRegistry` 按目录名排序，`t-max` 的子项目先于顶层 `tmax-operate-business` 入数组，**旧配置胜出**。结果：Pilot 迁移静默不生效，无任何警告。方案声称的「优先新项目并产生迁移警告」需要显式实现，当前不存在。

### 4.3 仓库唯一性校验与共存期直接冲突

阶段 1 要求「同一个仓库不能被两个独立项目声明」。共存期内旧子项目与新的顶层 `tmax-operate-business` 都声明 `operateBusiness`，必然触发该校验 → 硬失败。校验必须按「projectId 去重后再校验」或共存期豁免，方案未定义。

### 4.4 cwd 路由在共存期抛 ambiguous

`t-max` 保留 8 个 legacy repositories（方案明确要求），且失去 `childProjectIds` 后不再被 `findCwdMatches` 跳过。任意位于 `workspace/.local/t-max/mounts/repos/*` 的 cwd 会同时命中 `t-max`（key `t-max:dcm:/abs/path`）与 `tmax-dcm`（key `tmax-dcm:dcm:/abs/path`）——两个键不同，去重失效 → `requireSingleMatch` 抛 `ambiguous`。即：共存期内 cwd 路由完全不可用。

### 4.5 共享 Context 规格不完整，会打断 `ane-standard-page`

方案只给 `backgroundId / sourceDigest / contractDigest / selectedEvidence`，但 `loopRuntime.ts:169` 依赖 `background.integration.evidenceBundlesByLoop[loop.metadata.id]` 解析证据包。被丢弃的 `manifest`、`contract`、`executionModes`、`validators`、`evidenceBundlesByLoop` 全部是 load-bearing。共享 Context 必须整体携带 `background.integration`，不能只带 digest。

### 4.6 两份 loop 的 `handoff.project` 没有安排

`ane-standard-page` 与 `frontend-delivery` 声明 `handoff.project: t-max`，走的是 `validation.ts:111` 注释所述的「ProjectGroup 作为路由命名空间」机制。新模型下没有组可声明，方案未说明改成什么（改成一个具体项目？强制 `--target-project`？允许 catalog 继续作路由命名空间？）。不定这条，两份 loop 的语义就是悬空的。

### 4.7 Memory 隔离是既有欠账，不是迁移对象

`buildProjectContext` 生成的 `memoryNamespace` 是 `project:${id}/loop:${id}` 字符串，但物理落盘是扁平的 `cases/`、`loops/`，case frontmatter 一律 `project: xbaiProjectCode`。方案第五节描述的「memory/projects/tmax-kpiui/」目录树尚不存在。展平不会自动产生隔离，需要单独做。

---

## 五、「Harmony 方式」的判断偏差 / Misread of the Harmony Pattern

`harmony-wardrobe` 与 `trunkFeeder` 的实际形态是：**顶层 `kind: ProjectGroup` + 单个 repository + 不写 `children`**，并没有 `role: standalone` 字段。

现有 loader 已经完全支持这种形态：`loadChildProjectEntries` 在无 `children` 时直接 `return []`（`projectRegistry.ts:130`），组守卫也因 `childProjectIds` 为空而放行。也就是说，**把 8 个项目展平到顶层、写成 `kind: ProjectGroup` + 一个仓库 + 不写 children，今天就已经能直接路由，不需要 `role` 这个第二套正交字段。**

真正的新增只有一件事：**跨目录的共享引用**（`sharedContext` / `localPathsRef` / skill 继承）。方案阶段 1 里约 80% 的模型改造是在给已有能力加字段。

---

## 六、三个选项 / Options

| 选项 | 内容 | 工作量 | 适用前提 |
|---|---|---|---|
| **A（推荐）** | 维持嵌套；补 catalog 守卫冗余（4.1）、补 `evidenceBundlesByLoop` 回归测试、先跑通一次真实 `frontend-delivery` loop、再补 Memory 物理隔离 | 0.5–1 天 | 默认选项。结构刚落地，缺的是验证不是重构 |
| **B** | 展平，但**砍掉 `role` 字段**，只加 `sharedContextRef` + `localPathsRef`；**一次性切换，不做共存期**（无历史可迁移，共存期是纯负债） | 2–3 天 | 若确认 DSH 的 `@` 选择入口必须顶层可见 |
| **C** | 原方案五阶段 | 1 周以上 | 不推荐。需先修完 4.1–4.7，且保护的迁移成本为零 |

---

## 七、若采用选项 B 的最小改动清单 / Minimal Change List for Option B

1. `shared/types.ts`：`ProjectSpec` 增加 `sharedContextRef?: string`、`localPathsRef?: string`；保留 `kind`，不引入 `role`。
2. `shared/validation.ts:371`：把 `readDeclaredProject` 的判定从 `kind === 'ProjectGroup' && project.children` 改为支持 catalog 标记，并同步 `projectRegistry.ts` 的路由守卫。
3. `projectRegistry.ts`：新增跨目录共享解析（background / discoverySkills / localPaths 按被引用项目的目录解析），替换 `rebasePath` 的目录内语义。
4. `projectRegistry.ts:393`：`dedupeMatches` 键加入 `projectRoot`，避免静默折叠。
5. `loopRuntime.ts:169`：确保 `background.integration` 整体随共享 Context 透传，只缓存不裁剪。
6. `workspace/loops/*.loop.yaml`：明确 `handoff.project` 在 catalog 模型下的取值语义。
7. 一次性删除 `workspace/projects/t-max/projects/`，不留 legacy 分支。
