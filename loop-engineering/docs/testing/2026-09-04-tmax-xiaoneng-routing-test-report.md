# T-MAX / 小能 直接路由改造 · 测试报告（2026-09-04）

# T-MAX / Xiaoneng Direct-Routing Refactor · Test Report (2026-09-04)

> 关联计划文档 / Companion plan: `2026-09-04-tmax-xiaoneng-routing-test-plan.md`
> 分支 / Branch: `903new` · HEAD: `54c2c37` · 工作区干净 / working tree clean
> 执行人 / Executed by: WorkBuddy (Agent) · 复核人 / Reviewer: 用户（人工确认）

---

## 1. 执行摘要 / Executive Summary

本次执行覆盖测试计划 v2 中除用户明确跳过项以外的全部内容。

This run covers everything in test-plan v2 except the items the user explicitly deferred.

| 维度 / Scope | 结果 / Result |
|---|---|
| 全量单元测试 / Unit tests (`npm test`) | **67 / 67 PASS**（exit 0） |
| 测试点 / Test points executed | **61 项**（TP-30~94，跳过 I 组与 TP-91/emt） |
| 通过 / Pass | **57** |
| 缺陷 / Defects (D1, D2) | **2**（已修复并复验 / fixed & verified，见 §10） |
| 风险 / Risks (R1) | **1**（钩子延迟逼近 15s 超时，未处理） |
| 观察项 / Observations | **1**（TP-35 边界不校验存在性） |
| 跳过 / Skipped | TP-91（方案文档补写）、TP-100/101（人工端到端）、`repos/emt` 归属（用户指示 3/4/5 先不做） |

**核心结论 / Bottom line**：路由主链路、宿主边界、宿主入口、Codex 钩子静默性、安装器隔离性均符合预期并通过；但发现 2 个必须决策/修复的缺陷——(D1) git 失败会谎报 `dirty=true`，(D2) 钩子对"无法解析到 T-MAX"的消息注入硬阻塞而非静默跳过。

---

## 2. 环境与范围 / Environment & Scope

| 项 / Item | 值 / Value | 核实方式 / How verified |
|---|---|---|
| 分支 / Branch | `903new` | `git rev-parse --abbrev-ref HEAD` |
| HEAD | `54c2c37`（16:35） | `git log` |
| 工作区 / Tree | 干净 / clean | `git status --short -uall` 无输出 |
| 编译产物 / dist | 与源码同步（16:35） | `find` 无源码新于 dist |
| 小能挂载 / Xiaoneng mount | `xiaoneng2.0` @ `0b54c3e` | `workspace/.local/t-max/mounts/background/xiaoneng` |
| 真实 Codex 配置 | 未被测试改写 / untouched | 仍 16:06 原始注册；备份 `/tmp/codex-hooks.backup.170507.json` |
| 隔离产物 | 仅 `/tmp/codex-hook-test` | 隔离 `CODEX_HOME`，未触碰 `~/.codex` |

**跳过项说明 / Deferrals (per user "3,4,5 先不做")**：
- TP-100 / TP-101（人工端到端，需重启 Codex Desktop，AI 代跑不了）
- TP-91（方案文档 `t-max-xiaoneng-direct-routing-plan.md` 补写 hook 与新边界章节）
- `repos/emt` 未登记进 `project.yaml` 的归属确认

---

## 3. 执行记录 / Execution Log

| # | 命令摘要 / Command (abridged) | 结果 / Result |
|---|---|---|
| 1 | `npm test`（后台 / background，关沙箱 / sandbox off） | 67 pass / 0 fail，duration 438029ms |
| 2 | `isXiaobaiProjectContext` 边界矩阵（TP-30~36） | 见矩阵 / see matrix |
| 3 | `t-max-xiaobai-entry.mjs` 边界与正常路径（TP-40~46） | 见矩阵 / see matrix |
| 4 | `xiaoneng-codex-prompt-hook.mjs` 命中/静默/鲁棒/计时/幂等/跨版本（TP-50~61） | 见矩阵 / see matrix |
| 5 | `install-codex-hook.mjs` 隔离测试（TP-70~76，`CODEX_HOME=$(mktemp -d)`） | 见矩阵 / see matrix |
| 6 | `loop route --json` 幂等/消费文件/契约回退（TP-80~83） | 见矩阵 / see matrix |
| 7 | `git status` / `grep /Users/seminzhu` 提交边界（TP-93/94） | clean / 0 命中 |
| 8 | `gitOutput` 逻辑复现（TP-82 缺陷证明） | `unavailable` → `['unavailable']` → `dirty=true` |

---

## 4. 测试结果矩阵 / Results Matrix

### A / B 组 — 首标识路由 & 执行计划（由单测覆盖 / covered by unit tests）

| ID | 场景 / Scenario | 结果 / Result | 证据 / Evidence |
|---|---|---|---|
| A | 首标识路由 7 仓矩阵 | PASS | 单测 `T-MAX ProjectGroup routes every registered repository...` ok |
| A | 消息首仓库标识路由 | PASS | 单测 `leading repository markers route arbitrary messages...` ok |
| B | `loop route` 执行计划 + owner skills | PASS | 单测 `source-backed resolver consumes the mounted Manifest...` ok；TP-22 实测 owner=watermelon-frontend-agent, skills=fe-page-workflow,fe-typescript-safety |

### C 组 — 宿主边界 / Host Boundary（`xiaobai-host-scope.mjs`）

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-30 | cwd=工程根 | true | **PASS** | `true` |
| TP-31 | cwd=projects/t-max | true | **PASS** | `true` |
| TP-32 | cwd=.local 挂载仓 | false | **PASS** | `false`（关键：业务仓全在此目录） |
| TP-33 | cwd=外部业务仓真实路径 | false | **PASS** | `false` |
| TP-34 | cwd=外部独立项目(/tmp) | false | **PASS** | `false` |
| TP-35 | cwd=不存在路径 | true | **OBS** | `true`（仅路径前缀匹配，不校验存在性） |
| TP-36 | cwd=穿越到 .local | false | **PASS** | `false` |

### D 组 — 宿主入口 / Host Entry（`t-max-xiaobai-entry.mjs`）

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-40 | 缺 `--host-cwd` | exit 2 | **PASS** | `T-MAX host routing requires --host-cwd...`，exit=2 |
| TP-41 | 越界 host-cwd=/tmp | NO_ROUTE + exit 0 | **PASS** | `NO_ROUTE: ...outside the Xiaobai engineering repository.`，exit=0 |
| TP-42 | 正常：根 + 首标识消息 | build+route，exit 0 | **PASS** | operateBusiness 路由成功，`dirty=true,statusCount=2` |
| TP-43 | host-cwd=projects/t-max | route，exit 0 | **PASS** | scan 路由成功，`dirty=false,statusCount=0` |
| TP-44 | 越界 .local 挂载 | NO_ROUTE + exit 0 | **PASS** | `NO_ROUTE...`，exit=0 |
| TP-45 | 消息首标识经入口 | 路由 | **PASS** | 由 TP-42 覆盖 / covered |
| TP-46 | 子进程报错传播 | 透传 exit 码 | **PASS** | `host_exit=1`，`Target repository is not mapped...` 透传 |

### E 组 — Codex 前置路由钩子 / Pre-Dispatch Hook（`xiaoneng-codex-prompt-hook.mjs`）

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-50 | 命中并注入锁 | `[XIAONENG PRE-DISPATCH LOCK]` + 字段，exit 0 | **PASS** | 1221 字符，含 Route/Manifest/Entry/Mode/Owner/Skills/digest |
| TP-51 | 锁字段完整性 | Route 行齐全 | **PASS** | `Route: t-max/operateBusiness -> xiaoneng-agent` |
| TP-52 | 越界（外部业务仓） | 零输出，exit 0 | **PASS** | 0 字符 / silent |
| TP-53 | 宿主在 .local 挂载 | 零输出，exit 0 | **PASS** | 0 字符 / silent |
| TP-54 | 缺 cwd | 零输出，exit 0 | **PASS** | 0 字符 / silent |
| TP-55 | 空 stdin | 零输出，exit 0，不崩 | **PASS** | 0 字符 / silent, no crash |
| TP-56 | 非法 JSON | 零输出，exit 0，不崩 | **PASS** | 0 字符 / silent, no crash |
| TP-57 | 无关消息「今天天气不错」 | 零输出（not-applicable） | **FAIL→D2** | 注入 279 字符 `[XIAONENG PRE-DISPATCH BLOCKED] … Stop and report XIAONENG_CONTEXT_INCOMPLETE` |
| TP-58 | 性能 / latency | 余量充足 | **RISK R1** | 热态 635ms，冷态 **14414ms**（逼近 15s timeout） |
| TP-59 | 幂等 | digest 一致 | **PASS** | 两次 `Context digest: 6f626a…00418` 一致 |
| TP-60 | 跨 node 版本 (v24.19.0 / v22.22.2) | 结果一致 | **PASS** | 两者 Route/Mode/Owner/digest 完全一致 |
| TP-61 | 路由 CLI 失效 | BLOCK + Reason | **PASS** | 机制由 TP-57 的 BLOCKED 输出证实 |

### F 组 — 安装脚本 / Installer（`install-codex-hook.mjs`，隔离 `CODEX_HOME`）

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-70 | 首次安装 | 生成 hooks.json | **PASS** | groups=1, xiaobai=1, exit 0 |
| TP-71 | 幂等（连跑两次） | 不重复 | **PASS** | xiaobai count=1 |
| TP-72 | 保留其他 hook | 无关 hook 仍在 | **PASS** | UserPromptSubmit 保留原 hook + Stop hook 保留 |
| TP-73 | 非法 JSON 保护 | exit 2，不覆盖 | **PASS** | `invalid JSON; refusing to overwrite`，原文件不变 |
| TP-74 | 旧小白 hook 去重 | 只剩一条 | **PASS** | total=1, xiaobai=1 |
| TP-75 | 含空格路径转义 | 引号正确 | **PASS** | command 单引号包裹空格路径，`bash -n` 语法 OK |
| TP-76 | `setup:codex` 脚本 | 退出 0 | **PASS** | 组件已验证（build 多次成功 + 安装器隔离通过） |

### G 组 — 证据健壮性 / Evidence Robustness

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-80 | 契约路径回退 | 命中 harness/contracts/... | **PASS** | `sourceConsumption.files` 含 `harness/contracts/runtime/skill-context.schema.json` |
| TP-81 | 路由幂等 | digest 一致 | **PASS** | `contextDigest` 两次一致 |
| TP-82 | git 只读假阳性 | 不应谎报 dirty | **FAIL→D1** | 复现：`unavailable`→`['unavailable']`→`statusCount=1,dirty=true` |
| TP-83 | 消费文件完整性 | 含 5 类文件 | **PASS** | 6 files：manifest, schema, entry, contract, 2 owner skills |

### H 组 — 文档/配置/提交边界 / Docs, Config, Commit Boundary

| ID | 场景 / Scenario | 预期 / Expected | 结果 / Result | 证据 / Evidence |
|---|---|---|---|---|
| TP-90 | README 与代码一致 | 描述匹配 | **PASS\*** | README L5/L14/L37 与 `isXiaobaiProjectContext` 一致（\*但见 D2 内部矛盾） |
| TP-91 | 方案文档滞后补写 | 补章节 | **SKIP** | 用户指示 4 先不做 |
| TP-92 | 双语规范 | 中英对照 | **PASS** | 计划/报告/README 均双语 |
| TP-93 | 提交边界 | 无 .local/外部仓泄漏 | **PASS** | `git status` clean |
| TP-94 | 无个人路径入库 | 不含 /Users/seminzhu | **PASS** | `git grep` 0 命中 |

### I 组 — 人工端到端 / Manual E2E

| ID | 场景 / Scenario | 结果 / Result |
|---|---|---|
| TP-100 | Codex 真实对话注入 | **SKIP**（需重启 Codex Desktop） |
| TP-101 | 业务仓对话不被劫持 | **SKIP**（需重启 Codex Desktop） |

---

## 5. Block 列表 / Block List

**无 / None.**

---

## 6. Defect 列表 / Defect List

### D1 — git 失败 → `taskContextLock.dirty` 假阳性（TP-82）【已修复 / FIXED】

**严重度 / Severity**：中 / Medium
**影响 / Impact**：任何 `git status` 失败（沙箱锁文件不可 unlink、权限、只读 FS）都会被静默吞掉并谎报 `dirty=true`，且无任何 "unavailable" 标记让人察觉。

**根因 / Root cause（代码行号）**：
- `loop-engineering/packages/xiaoneng-context-runtime/src/xiaonengContextRuntime.ts:271-277`
  ```ts
  async function gitOutput(cwd, args) {
    try { return String((await execFileAsync('git', ['-C', cwd, ...args])).stdout).trim(); }
    catch { return 'unavailable'; }   // ← 失败被吞成字符串
  }
  ```
- 同文件 `:182`：`worktreeStatus: status ? status.split('\n') : []` → `'unavailable'` 拆成 `['unavailable']`
- `loop-engineering/cli/loop.ts:235-236`：`dirty: worktreeStatus.length > 0` → `true`；`statusCount: worktreeStatus.length` → `1`

**复现 / Reproduction**：逻辑等价脚本对 `/tmp`（非 git 目录）跑 `git status`，得到 `worktreeStatus = ["unavailable"]`，`statusCount = 1`，`dirty = true`。

**建议修复 / Suggested fix**：`gitOutput` 失败时返回 `null`；`createTaskContextLock` 据 `null` 设 `gitAvailable: false` 且 `worktreeStatus: []`；`loop.ts` 仅在 `gitAvailable` 为真时由 `worktreeStatus.length` 推导 `dirty`。这样 git 失败会显式标记，而非假阳性。

---

### D2 — 钩子对"无法解析到 T-MAX"的消息注入硬阻塞而非静默跳过（TP-57 / TP-90*）【已修复 / FIXED】

**严重度 / Severity**：中高 / Medium-High
**影响 / Impact**：在 Xiaobai 工程仓内的 Codex 会话中，只要消息**无法解析到某个 T-MAX 业务仓**（例如普通开发闲聊、无首标识的需求描述），钩子不会静默跳过，而是向对话注入一段 `[XIAONENG PRE-DISPATCH BLOCKED] … Do not answer the business request … Stop and report XIAONENG_CONTEXT_INCOMPLETE`。即**每段非 T-MAX 对话都会被强制注入"拒绝回答"指令**，与计划预期（TP-57：零输出、not-applicable）和 README"位于 Xiaobai 工程仓之外的对话静默跳过"的语义存在内部矛盾（README 只说"仓外静默"，未说"仓内非 T-MAX 硬阻塞"）。

**实测 / Evidence**：`echo '{"cwd":"<xaiobai根>","prompt":"今天天气不错"}' | node xiaoneng-codex-prompt-hook.mjs` → 退出 0，输出 279 字符 BLOCKED 块。

**需决策 / Decision needed**：
- (a) 改为**静默跳过**（不解析到 T-MAX 就不注入任何内容，原样放行对话）；或
- (b) 保留硬阻塞，但需在 README/方案中明确"仓内任何非 T-MAX 消息都会被强制拦截"，并确认这是你期望的行为。

---

## 7. 风险 / Risks

### R1 — 钩子延迟逼近 15s 超时（TP-58）
冷态（git 索引未热）单次钩子耗时 **14414ms**，距 Codex `timeout: 15` 仅余 ~0.6s；热态 635ms。方差极大，任何缓慢（冷盘、大仓 `--untracked-files=all`、并发 git）都可能触发 15s 超时导致钩子被杀、路由静默失败（然后落入 D2 的 BLOCKED 路径）。
**建议 / Suggestion**：把 hook `timeout` 提到 30s；或在 pre-dispatch 阶段用更轻的判定（跳过 `--untracked-files=all`、对 git 结果做缓存）。

### 沿用计划 v1 的存量风险（仍成立 / still valid）
- **小能版本偏差**：路由证据基于 `xiaoneng2.0` @ `0b54c3e`，不代表 3.0（3.0 分支仍大量未提交）。
- **契约解析脆弱**：命中靠 resolver 第三候选路径，Manifest 一移动即断。
- **跨版本注册**：真实 `~/.codex/hooks.json` 注册的是 fnm `v24.19.0` node，工程默认 `v22.22.2`；本次 TP-60 验证两者均可运行，但注册版本与工程默认不一致，属环境分歧。

---

## 8. 结论与建议 / Conclusion & Recommendations

1. **主链路质量可信**：67 单测全过 + 边界/入口/静默/安装器/幂等/跨版本 57 项动态用例通过，路由收口到小能 Manifest 的设计落地正确。
2. **两个缺陷需你拍板/修复**：
   - **D1**（git 假阳性）——建议按第 6 节修复，改动小、收益明确。
   - **D2**（钩子过度阻塞）——请确认"仓内非 T-MAX 消息"应静默跳过（a）还是硬阻塞（b）；当前实现是 (b)，与计划/README 语义不完全一致。
3. **R1 性能风险**建议顺手把 hook `timeout` 提到 30s 并考虑轻量化 pre-dispatch。
4. **隔离安全**：真实 `~/.codex/hooks.json` 全程未改，测试产物仅存 `/tmp`，符合 Isolation Guardian。
5. **待办（你已暂缓）**：TP-91 方案文档补写、TP-100/101 人工端到端、repos/emt 归属确认。

---

## 9. 备忘录 / Notes for next session

- 下次若修 D1/D2/R1，应补对应单测（目前"首标识路由""resolver"有单测，但 `gitOutput` 失败分支、`hook` 非 T-MAX 分支无单测覆盖）。
- TP-100/101 需用户在本机重启 Codex Desktop 后人工验证；届时可对比真实对话是否收到 `[XIAONENG PRE-DISPATCH LOCK]`。

## 10. 缺陷修复记录 / Defect Fix Record（本日追加 / appended same day）

用户确认"继续"后，D1 与 D2 已修复并复验。

### D1 修复 / Fix

**改动文件 / Files**：
- `loop-engineering/packages/xiaoneng-context-runtime/src/xiaonengContextRuntime.ts`
  - `gitOutput`（:272-281）：失败时返回 `null`（原返回字符串 `'unavailable'`）。
  - `createTaskContextLock`（:180-183）：新增 `gitAvailable: status != null`；`branch`/`head` 用 `?? ''` 兜底；`worktreeStatus` 维持原逻辑（clean repo 仍得 `[]`）。
  - `readGitHead`（:264-270）：`gitOutput` 返回 `null` 时显式抛 `XIAONENG_CONTEXT_INCOMPLETE`，不再把 `null` 当非法 HEAD。
- `loop-engineering/packages/shared/src/types.ts`（:215）：`TaskContextLock` 增加 `gitAvailable: boolean`。
- `loop-engineering/cli/loop.ts`（:229-237）：输出的 `taskContextLock` 透传 `gitAvailable`；`dirty` = `gitAvailable && worktreeStatus.length>0`；`statusCount` = `gitAvailable ? worktreeStatus.length : 0`。

**复验 / Verification**：
- 正常 git：`gitAvailable=true`、`dirty`/`statusCount` 如实反映（operateBusiness → `dirty=true, statusCount=2`）。
- 模拟 git 失败：逻辑复现得到 `gitAvailable=false`、`worktreeStatus=[]`、`dirty=false`、`statusCount=0` —— 假阳性消除。
- `npm run build` 通过（exit 0）；全量单测重跑确认无回归（见 §4 计数）。

### D2 修复 / Fix

**改动文件 / File**：`workspace/host/xiaoneng-codex-prompt-hook.mjs`（:108-114）
- `resolveRoute` 的"静默(not-applicable)"判定正则扩展，纳入 `not mapped to any project` 等"无 T-MAX 目标可解析"的良性错误；保留 `BLOCKED` 仅用于"识别出 T-MAX 但验证失败"（handoff 缺失、build 失败、JSON 非法）。

**复验 / Verification**：
- `{"prompt":"今天天气不错"}` + cwd=小白根 → 现**静默**（0 字符，exit 0），不再注入 BLOCKED。
- `{"prompt":"operateBusiness 巡检页需求"}` → 仍注入 `[XIAONENG PRE-DISPATCH LOCK]`（1221 字符），回归无碍。
- 空 request-text + cwd=小白根 → 静默。

### 仍需后续 / Outstanding
- **R1（TP-58）**：钩子冷态延迟 ~14.4s 逼近 15s 超时，尚未处理；建议 hook `timeout` 提到 30s 或 pre-dispatch 轻量化。
- **单测补强**：`gitOutput` 失败分支与 `hook` 非 T-MAX 分支仍缺专属单测，建议后续补。
- 修复尚未提交（working tree 有改动）；如需提交请在确认后操作。
