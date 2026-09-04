# 2026-09-04 T-MAX 小能直达路由 测试计划（v2）/ Test Plan (v2)

中文：

v2 取代同日早些时候的 v1。原因：小白在 14:51 与 16:35 又提交了 `0735d81`、`54c2c37`，宿主入口的**作用域模型被收窄**，并新增了一整套 **Codex `UserPromptSubmit` 前置路由钩子**，测试范围从「路由内核 + CLI」扩大到「宿主边界 + 宿主入口 + AI 客户端钩子 + 用户级安装脚本」。本轮仍只输出计划，不执行测试。

English:

v2 replaces v1 from earlier the same day. Xiaobai committed `0735d81` (14:51) and `54c2c37` (16:35), which narrowed the host entry's **scope model** and added a full **Codex `UserPromptSubmit` pre-dispatch hook**. Coverage therefore expands from "routing core + CLI" to "host boundary + host entry + AI-client hook + user-level installer". This round still produces the plan only; no test is executed.

---

## 1. 变更清单 / Change Inventory

中文：

| # | 提交 / 状态 | 标识 | 内容 | 规模 |
|---|---|---|---|---|
| C1 | 已提交 | `2c8a9c0` 09:36 | 删除过期 lifecycle 产物 | -71 |
| C2 | 已提交 | `cf18762` 13:30 | 项目运行时改走小能：`RuntimeExecutionPlan`/`XiaonengHandoffPlan`/`EffectiveOrchestrator`；`manifest-source` 跳过 workflow/generator/evaluator；三个 `project.yaml` 补 `runtime.type` | +312/-677 |
| C3 | 已提交 | `0735d81` 14:51 | 首标识路由 `leading-repository`；`loop route` 子命令与 `--request-text`/`--xiaoneng-execution-mode`；5 个新用例；编排器与 SKILL.md 强制小能入口；宿主入口首版 | +442/-2 |
| C4 | **已提交（新增）** | `54c2c37` 16:35 | **宿主边界收窄**：新增 `xiaobai-host-scope.mjs`、`install-codex-hook.mjs`、`xiaoneng-codex-prompt-hook.mjs`、`host-routing.test.ts`、`setup:codex` 脚本；宿主入口强制 `--host-cwd` 校验；README 重写 | +381/-6 |

English:

| # | Commit / State | ID | Content | Size |
|---|---|---|---|---|
| C1 | Committed | `2c8a9c0` 09:36 | Removed obsolete lifecycle artifacts | -71 |
| C2 | Committed | `cf18762` 13:30 | Routed project runtimes through Xiaoneng: `RuntimeExecutionPlan`/`XiaonengHandoffPlan`/`EffectiveOrchestrator`; `manifest-source` skips workflow/generator/evaluator; `runtime.type` added to three `project.yaml` files | +312/-677 |
| C3 | Committed | `0735d81` 14:51 | Leading-marker `leading-repository` routing; `loop route` subcommand with `--request-text`/`--xiaoneng-execution-mode`; five new cases; orchestrator and SKILL.md mandatory Xiaoneng entry; first host-entry version | +442/-2 |
| C4 | **Committed (new)** | `54c2c37` 16:35 | **Narrowed host scope**: added `xiaobai-host-scope.mjs`, `install-codex-hook.mjs`, `xiaoneng-codex-prompt-hook.mjs`, `host-routing.test.ts`, `setup:codex`; host entry now enforces `--host-cwd`; README rewritten | +381/-6 |

### C4 新增文件职责 / Responsibilities Of New C4 Files

中文：

| 文件 | 职责 | 关键行为 |
|---|---|---|
| `xiaobai-host-scope.mjs` | 宿主边界判定 | `cwd` 必须在小白工程仓真实路径内，且**不在** `workspace/.local` 下，否则 `false` |
| `t-max-xiaobai-entry.mjs` | 宿主入口 CLI | 缺 `--host-cwd` → exit 2；越界 → 打印 `NO_ROUTE` 并 **exit 0** |
| `xiaoneng-codex-prompt-hook.mjs` | Codex `UserPromptSubmit` 钩子 | 读 stdin JSON；越界/无 cwd → exit 0 静默；命中 t-max → 输出 `[XIAONENG PRE-DISPATCH LOCK]` 证据块 |
| `install-codex-hook.mjs` | 用户级安装器 | 幂等改写 `$CODEX_HOME/hooks.json`，保留其他 hook，只替换小白自己的；非法 JSON 时拒绝覆盖 |
| `host-routing.test.ts` | 边界单测 | 5 组 `isXiaobaiProjectContext` 断言 |

English:

| File | Responsibility | Key behavior |
|---|---|---|
| `xiaobai-host-scope.mjs` | Host boundary decision | `cwd` must resolve inside the Xiaobai root and **not** under `workspace/.local`, otherwise `false` |
| `t-max-xiaobai-entry.mjs` | Host entry CLI | Missing `--host-cwd` → exit 2; out of scope → prints `NO_ROUTE` and **exit 0** |
| `xiaoneng-codex-prompt-hook.mjs` | Codex `UserPromptSubmit` hook | Reads stdin JSON; out of scope or no cwd → exit 0 silently; t-max match → emits `[XIAONENG PRE-DISPATCH LOCK]` evidence block |
| `install-codex-hook.mjs` | User-level installer | Idempotently rewrites `$CODEX_HOME/hooks.json`, preserving other hooks and replacing only Xiaobai's; refuses to overwrite invalid JSON |
| `host-routing.test.ts` | Boundary unit test | Five `isXiaobaiProjectContext` assertions |

---

## 2. 设计意图变化（本轮重点）/ Design Direction Change

中文：

v1 计划基于「从任一 T-MAX 业务仓启动新窗口」的宿主模型。C4 把它改成：

```text
旧模型：宿主在业务仓 → 调用小白入口 → 走小能
新模型：宿主必须在小白工程仓内 → 才允许建立 bridge → 走小能
        业务仓内的对话不属于小白宿主上下文，静默跳过，由该业务仓自己的 Xiaoneng 决定
```

这带来一个**必须验证的推论**：因为作用域排除了 `workspace/.local`（所有业务仓软链接都在其下），`loop route --target-cwd` 靠 cwd 命中 T-MAX 仓库的路径**全部落在被排除区域内**。所以新模型下，唯一能命中的路由通道是**用户消息首仓库标识**（`leading-repository`）。这一推论如果成立，则首标识规则从「优化项」升格为「唯一入口」，其健壮性测试的优先级应提到最高。

English:

Plan v1 assumed a host model of "start a window from any T-MAX business repository". C4 changed it to:

```text
Old: host in a business repository -> call the Xiaobai entry -> route to Xiaoneng
New: host must be inside the Xiaobai engineering repository -> bridge is allowed -> route to Xiaoneng
     A conversation inside a business repository has no Xiaobai host context and is skipped silently;
     that repository's own Xiaoneng decides routing
```

This produces an **inference that must be verified**: because the scope check excludes `workspace/.local` (where every business-repository symlink lives), every path where `loop route --target-cwd` could match a T-MAX repository **falls inside the excluded region**. Under the new model the only working channel is therefore the **leading repository marker in the user message** (`leading-repository`). If that holds, the leading-marker rule is promoted from an optimization to the single entrypoint, and its robustness tests deserve the highest priority.

---

## 3. 测试目标 / Objectives

中文：

1. 验证宿主边界判定在各类路径下的真伪（含软链接穿透、`.local` 排除、不存在的路径、路径穿越）。
2. 验证宿主入口在参数缺失 / 越界 / 正常三类场景下的退出码与输出（重点：`NO_ROUTE` 必须 exit 0 而非报错）。
3. 验证 Codex 钩子的**注入有效性**（命中时输出完整锁证据）、**静默性**（越界时零输出 exit 0）、**鲁棒性**（空/非法 stdin 不崩）。
4. 验证安装脚本在**隔离环境**下的幂等性、保留性、容错性（不碰真实 `~/.codex`）。
5. 验证首标识路由在失去 cwd 通道后仍能独立命中 7 个仓库。
6. 测量钩子端到端耗时，判断 Codex 的 15 秒 `timeout` 是否安全。
7. 回归：非 T-MAX 项目、`manifest-source` 执行计划、提交边界。

English:

1. Verify host boundary decisions across path classes (symlink resolution, `.local` exclusion, non-existent paths, path traversal).
2. Verify host-entry exit codes and output for missing arguments, out-of-scope calls, and normal calls (`NO_ROUTE` must exit 0, not error).
3. Verify the Codex hook's **injection effectiveness** (complete lock evidence on match), **silence** (zero output, exit 0 when out of scope), and **robustness** (no crash on empty or invalid stdin).
4. Verify installer idempotence, preservation, and fault tolerance in an **isolated environment** (never touching the real `~/.codex`).
5. Verify that leading-marker routing still resolves all seven repositories without the cwd channel.
6. Measure hook end-to-end latency to judge whether Codex's 15-second `timeout` is safe.
7. Regression: non-T-MAX projects, `manifest-source` execution plans, and the commit boundary.

---

## 4. 环境前提（已核实）/ Environment Preconditions (verified)

中文：

| 项 | 现状 | 影响 |
|---|---|---|
| 分支 / HEAD | `903new` @ `54c2c37`，工作区干净（除本计划文件） | 测试基于已提交状态，无需 stash |
| 编译产物 | `dist/` 16:35，与源码同步（无源码新于 dist） | CLI 可直接跑，无需重编译 |
| `~/.codex/hooks.json` | **已于 16:06 安装**，含小白 hook，指向 fnm `v24.19.0` 的 node | 真实环境已有副作用；安装器测试必须隔离 |
| 钩子运行时 node | `/Users/seminzhu/.local/share/fnm/node-versions/v24.19.0/installation/bin/node`（存在） | 与工程默认 node `v22.22.2` 不同，需跨版本验证 |
| `CODEX_HOME` | 未设置 → 默认 `~/.codex` | 安装器测试可用 `CODEX_HOME=<tmp>` 隔离 |
| 小能挂载 | `xiaoneng2.0` @ `0b54c3e` | 路由证据只代表 2.0 的 Manifest |
| 业务仓挂载 | 7 个 T-MAX 仓 + 未登记的 `emt` | `emt` 归属待确认 |
| 文档残留 | grep 未发现「从业务仓启动新窗口」的旧说法 | README 已与 C4 同步；方案文档未覆盖 hook（P2） |

English:

| Item | State | Impact |
|---|---|---|
| Branch / HEAD | `903new` @ `54c2c37`, clean tree (except this plan) | Tests run against committed state; no stash needed |
| Build output | `dist/` at 16:35, in sync with sources | CLI runs directly; no rebuild needed |
| `~/.codex/hooks.json` | **Already installed at 16:06**, contains the Xiaobai hook, points at fnm `v24.19.0` node | Real environment already has side effects; installer tests must be isolated |
| Hook runtime node | `/Users/seminzhu/.local/share/fnm/node-versions/v24.19.0/installation/bin/node` (exists) | Differs from the project default node `v22.22.2`; cross-version verification needed |
| `CODEX_HOME` | unset → defaults to `~/.codex` | Installer tests can isolate with `CODEX_HOME=<tmp>` |
| Xiaoneng mount | `xiaoneng2.0` @ `0b54c3e` | Routing evidence describes the 2.0 Manifest only |
| Business mounts | Seven T-MAX repositories plus unregistered `emt` | `emt` ownership to confirm |
| Doc residue | No stale "start a window from a business repository" wording found | README is in sync with C4; the plan doc does not cover the hook (P2) |

---

## 5. 角色分工 / Roles

中文：

| 角色 | 职责 | 承担人 |
|---|---|---|
| TP Owner | 维护本计划、判定 Block/Defect 级别 | AI（小白） |
| Executor | 执行命令清单，采集原始输出 | AI（小白） |
| Isolation Guardian | 执行前备份 `~/.codex/hooks.json`，确保测试不污染真实 Codex 配置 | AI（小白） |
| Reviewer | 确认计划、确认报告结论、决定是否放行 | 用户（zhusemin） |
| Verifier（人工） | 重启 Codex Desktop 后，在真实对话中确认锁注入 | 用户（zhusemin） |
| Code Owner | 修复 P0/P1 缺陷 | AI（小白，经确认后） |

English:

| Role | Responsibility | Owner |
|---|---|---|
| TP Owner | Maintains this plan, grades Block/Defect severity | AI (Xiaobai) |
| Executor | Runs the command list, captures raw output | AI (Xiaobai) |
| Isolation Guardian | Backs up `~/.codex/hooks.json` before tests, keeps the real Codex config clean | AI (Xiaobai) |
| Reviewer | Confirms the plan, confirms report conclusions, decides release | User (zhusemin) |
| Verifier (manual) | Restarts Codex Desktop and confirms lock injection in a real conversation | User (zhusemin) |
| Code Owner | Fixes P0/P1 defects | AI (Xiaobai, after confirmation) |

---

## 6. 测试点矩阵 / Test Point Matrix

图例：`A` 自动单测 `M` 手工命令 `S` 静态检查 `H` 需人工 · `P0` 阻断 `P1` 严重 `P2` 一般

Legend: `A` automated unit test, `M` manual command, `S` static review, `H` human · `P0` blocker, `P1` major, `P2` minor

### A. 首标识路由与执行计划 / Leading-Marker Routing And Execution Plan

| ID | 场景 / Scenario | 输入 / Input | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-01 | 7 仓首标识全部命中 | `userMessage: '<repo> 任意内容'` × 7 | `source=leading-repository`、`project.id=t-max`、`targetRepository.id=<repo>` | A | P0 |
| TP-02 | 标识后紧跟中文无空格 | `operateBusiness项目内容与路由无关` | 命中 `operateBusiness` | A | P0 |
| TP-03 | 首标识压过 `--target-repository` | `operateBusiness任意后文` + `targetRepository=operateSupport` | 仍为 `operateBusiness` | A | P0 |
| TP-04 | 标识不在开头 | `请处理 operateBusiness 项目` | reject `/requires a target project or repository/` | A | P0 |
| TP-05 | 首标识压过 `--target-project` | `scan 巡检页需求` + `targetProject=t-max` | `source=leading-repository`、`matchedRepositoryId=scan` | M | P1 |
| TP-06 | BOM + 连续空白前缀 | `'\uFEFF   operateBusiness 需求'` | 命中 | A | P2 |
| TP-07 | 前缀误匹配防护 | `operateBusinessXxx 哈` | 不命中，无其他路由时报错 | A | P1 |
| TP-08 | 空串 / 纯空白消息 | `'   '` | 回落既有路由，不误命中 | A | P2 |
| TP-09 | 未登记仓 `emt` | `--target-repository emt` | 报错且提示未登记 | M | P2 |
| TP-10 | T-MAX 7 仓交小能 | 7 仓 dry-run | `executor=xiaoneng`、`generatorRuns=[]`、`evaluations=[]`、`workflow=undefined` | A | P0 |
| TP-11 | `DesignOnly` 档位 | mode=`DesignOnly`, repo=`operateBusiness` | `ownerAgent=orange-architect-agent`、`ownerSkills=[sa-component-gate, sa-page-plan]` | A | P0 |
| TP-12 | 默认档位 | 不传 mode | `PageImplementation`、`ownerAgent=watermelon-frontend-agent` | A | P1 |
| TP-13 | 非法档位 | `--xiaoneng-execution-mode NoSuchMode` | 抛 `XIAONENG_CONTEXT_INCOMPLETE` | A | P1 |
| TP-14 | 回归：非 manifest-source | `harmony-wardrobe` / `trunkFeeder` / `app-a` | `executor=xiaobai`、`workflow` 存在、generator/evaluator 非空 | A | P0 |
| TP-15 | manifest-source 缺 target | `--target-project t-max` 不指定仓库 | 抛 `XIAONENG_HANDOFF_INCOMPLETE` | M | P1 |
| TP-16 | orchestrator 证据 | 任意 T-MAX dry-run | `effective.source=manifest-source`，含 entry/manifest/owner | A | P1 |

### B. CLI `route` / `dry-run`

| ID | 场景 / Scenario | 命令要点 / Command | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-20 | dry-run + 指定档位 | `--xiaoneng-execution-mode DesignOnly` | `execution.executor=xiaoneng`、`effective.ownerAgent=orange-architect-agent` | A | P0 |
| TP-21 | dry-run + 首标识 | `--request-text 'operateBusiness 只是普通问题'` | `resolution.source=leading-repository` | A | P0 |
| TP-22 | `route` 显式仓库 | `--target-repository operateBusiness` | `executor=xiaoneng`、`write=none`、`taskContextLock` 五字段齐全 | M | P0 |
| TP-23 | `route` 首标识 | `--request-text 'scan 任意问题'` | `routeSource=leading-repository` | M | P0 |
| TP-24 | `route` cwd 通道（**预期失效**） | `--target-cwd <挂载的 operateBusiness>` | 记录实际结果：命中 or 不命中；用于验证第 2 节推论 | M | P0 |
| TP-25 | `route` 无目标 | 无参数 | 非 0 退出，含 `PROJECT_ROUTE_INCOMPLETE` | M | P1 |
| TP-26 | help 覆盖 | `loop help` | 含 `loop route` 行及两个新参数 | M | P2 |
| TP-27 | 人类可读输出 | `route --target-repository dcm`（无 `--json`） | 含 `Host:`/`Route source:`/`Executor:`/`Write: none` | M | P2 |

### C. 宿主边界（新增）/ Host Boundary (new)

| ID | 场景 / Scenario | 输入 / Input | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-30 | 工程仓根 | `cwd=<xiaobaiRoot>` | `true` | A | P0 |
| TP-31 | 工程仓子目录 | `cwd=<xiaobaiRoot>/workspace/projects/t-max` | `true` | A | P0 |
| TP-32 | 外部业务仓 | `cwd=/tmp/.../T-MAX/operateBusiness` | `false` | A | P0 |
| TP-33 | 外部独立项目 | `cwd=/tmp/.../harmonyWardrobe` | `false` | A | P0 |
| TP-34 | 挂载目录 | `cwd=<xiaobaiRoot>/workspace/.local/t-max/mounts/repos/operateBusiness` | `false`（软链接穿透后落在仓外） | A | P0 |
| TP-35 | **新增** 路径不存在 | `cwd=<xiaobaiRoot>/does/not/exist` | `false`，且**不抛异常** | M | P1 |
| TP-36 | **新增** 路径穿越尝试 | `cwd=<xiaobaiRoot>/workspace/projects/../.local` | `false`（realpath 归一后落在 `.local`） | M | P1 |

### D. 宿主入口 CLI（行为已变更）/ Host Entry CLI (behavior changed)

| ID | 场景 / Scenario | 命令要点 / Command | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-40 | 正常路由 | `--host-cwd <xiaobaiRoot> --cwd <operateBusiness> --message 'operateBusiness 任意消息'` | exit 0，JSON 中 `executor=xiaoneng` | M | P0 |
| TP-41 | **变更** 缺 `--host-cwd` | 只给 `--cwd`/`--message` | exit 2 + `requires --host-cwd` | M | P0 |
| TP-42 | **新增** 越界宿主 | `--host-cwd /tmp` | 输出 `NO_ROUTE`，**exit 0** | M | P0 |
| TP-43 | **新增** 宿主在 `.local` 下 | `--host-cwd <xiaobaiRoot>/workspace/.local/...` | `NO_ROUTE`，exit 0 | M | P1 |
| TP-44 | 缺消息与仓库 | 只给 `--host-cwd` | exit 2 | M | P1 |
| TP-45 | 未知参数 | `--foo bar` | exit 2 + `Unknown argument` | M | P2 |
| TP-46 | 路由失败即停 | `--host-cwd <xiaobaiRoot> --cwd /tmp` | 非 0 退出，无兜底输出 | M | P0 |

### E. Codex 前置路由钩子（新增，风险最高）/ Codex Pre-Dispatch Hook (new, highest risk)

中文：所有用例以 stdin 传入 JSON，例如 `echo '{"cwd":"...","prompt":"..."}' | node workspace/host/xiaoneng-codex-prompt-hook.mjs`。

English: every case pipes JSON through stdin, for example `echo '{"cwd":"...","prompt":"..."}' | node workspace/host/xiaoneng-codex-prompt-hook.mjs`.

| ID | 场景 / Scenario | 输入 / Input | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-50 | 命中并注入锁 | `cwd`=小白仓内，`prompt`=`'operateBusiness 巡检页需求'` | 输出以 `[XIAONENG PRE-DISPATCH LOCK]` 开头，含 Route/Manifest/Entry/Mode/Owner/Skills/Context digest；exit 0 | M | P0 |
| TP-51 | 锁字段完整性 | 同上 | 证据行齐全，`Route: t-max/operateBusiness -> xiaoneng-agent` | M | P0 |
| TP-52 | 越界静默 | `cwd`=业务仓真实路径 | **零输出**，exit 0 | M | P0 |
| TP-53 | 宿主在 `.local` 下 | `cwd`=挂载目录 | 零输出，exit 0 | M | P1 |
| TP-54 | 缺 `cwd` | `{"prompt":"operateBusiness 需求"}` | 零输出，exit 0 | M | P1 |
| TP-55 | 空 stdin | `echo -n ''` | 零输出，exit 0，不崩 | M | P1 |
| TP-56 | 非法 JSON | `echo 'not-json'` | 零输出，exit 0，不崩 | M | P1 |
| TP-57 | 无关消息 | `cwd`=小白仓内，`prompt`=`'今天天气不错'` | 零输出，exit 0（not-applicable） | M | P0 |
| TP-58 | **性能** | 计时 TP-50 | 输出耗时；判定 15s `timeout` 余量 | M | P0 |
| TP-59 | 幂等 | 同输入连跑两次 | `Context digest` 一致 | M | P1 |
| TP-60 | **跨 node 版本** | 用 fnm `v24.19.0` 的 node 跑 TP-50 | 结果与 node `v22.22.2` 一致 | M | P1 |
| TP-61 | 路由 CLI 失效 | 让 `loop route` 返回非 0（**不删 dist**，用无效参数模拟） | 输出 `[XIAONENG PRE-DISPATCH BLOCKED]` + Reason，exit 0 | M | P2 |

### F. 安装脚本（隔离执行，禁止触碰真实 `~/.codex`）/ Installer (isolated; never touch real `~/.codex`)

中文：全部用例设 `CODEX_HOME=$(mktemp -d)`，脚本会自动写入该目录。

English: every case sets `CODEX_HOME=$(mktemp -d)`; the script writes there automatically.

| ID | 场景 / Scenario | 操作 / Action | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-70 | 首次安装 | 空 `CODEX_HOME` 执行 | 生成 `hooks.json`，结构符合 README 示例 | M | P0 |
| TP-71 | 幂等 | 连跑两次 | 两次文件内容一致，hook 不重复 | M | P0 |
| TP-72 | 保留其他 hook | 预置一个无关 `UserPromptSubmit` hook 后执行 | 无关 hook 仍在 | M | P0 |
| TP-73 | 替换旧小白 hook | 预置一条旧路径小白 hook 后执行 | 只剩一条，路径更新为当前工程根 | M | P1 |
| TP-74 | 非法 JSON 保护 | `hooks.json` 写入坏 JSON | exit 2，**文件未被覆盖** | M | P0 |
| TP-75 | 路径转义 | 用含空格或单引号的目录模拟 `XIAOBAI_PROJECT_ROOT` | 生成的 command 引号正确，可被 shell 解析 | M | P1 |
| TP-76 | `setup:codex` 脚本 | 隔离环境跑 `npm run setup:codex` | 先 build 后安装，退出码 0 | M | P1 |

### G. 证据健壮性 / Evidence Robustness

| ID | 场景 / Scenario | 方法 / Method | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-80 | 契约路径回退 | 记录 `skillContext` 命中候选 | 落在 `harness/contracts/runtime/skill-context.schema.json` | M | P1 |
| TP-81 | 路由幂等 | `loop route --json` 连跑两次 | digest/hash 完全一致 | M | P1 |
| TP-82 | git 只读假阳性 | 沙箱内/外各跑一次 `route` | 对比 `taskContextLock.worktreeStatus`；若为 `['unavailable']` 则 `dirty=true` 属假阳性 | M | P1 |
| TP-83 | 消费文件完整性 | 检查 `sourceConsumption.files` | 含 manifest、schema、entry、contract、owner skills | M | P2 |

### H. 文档、配置与提交边界 / Docs, Config, And Commit Boundary

| ID | 场景 / Scenario | 方法 / Method | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-90 | 边界与文档一致 | README「只有 Xiaobai 工程仓内」vs `xiaobai-host-scope.mjs` | 描述与代码一致 | S | P1 |
| TP-91 | 方案文档滞后 | plan 文档 vs C4 | 记录：plan 未覆盖 hook 与新边界（建议补章节） | S | P2 |
| TP-92 | 双语规范 | 本轮新增 Markdown | 中英对照 | S | P2 |
| TP-93 | 提交边界 | `git status --short -uall` | 无 `.local`、`local.paths.yaml`、`workspace.local.yaml`、外部仓内容 | S | P0 |
| TP-94 | **新增** 无个人路径入库 | grep 已提交文件中是否出现 `/Users/seminzhu` 绝对路径 | 不含个人绝对路径 | S | P1 |

### I. 人工端到端 / Manual End-To-End

| ID | 场景 / Scenario | 步骤 / Steps | 预期 / Expected | 类型 | 优先级 |
|---|---|---|---|---|---|
| TP-100 | Codex 真实对话注入 | 完全退出并重启 Codex Desktop → 在小白工程仓新建对话 → 发送 `operateBusiness 巡检页需求` | 助手收到 `[XIAONENG PRE-DISPATCH LOCK]` 并以 `xiaoneng-agent` 顶层角色回应 | H | P0 |
| TP-101 | 业务仓对话不被劫持 | 在 `Documents/ane/code/git/T-MAX/operateBusiness` 新建 Codex 对话 | 无锁注入，行为与安装前一致 | H | P1 |

---

## 7. 执行命令清单（待确认后执行）/ Command List (pending confirmation)

中文：

```bash
cd /Users/seminzhu/Documents/AI/xbaiProjectCode
HOST=$PWD
BIZ=/Users/seminzhu/Documents/ane/code/git/T-MAX/operateBusiness
HOOK=workspace/host/xiaoneng-codex-prompt-hook.mjs

# ── 0. 前置保护：备份真实 Codex 配置（Isolation Guardian）
cp ~/.codex/hooks.json /tmp/codex-hooks.backup.$(date +%H%M%S).json

# ── 1. 全量单测（含新增 host-routing.test）—— 后台执行，避免 SIGKILL
npm test

# ── 2. 定向单测
node --test dist/loop-engineering/tests/host-routing.test.js
node --test dist/loop-engineering/tests/xiaoneng-context.test.js
node --test dist/loop-engineering/tests/runtime.test.js

# ── 3. CLI 路由（TP-22 ~ TP-27）
npm run loop -- route --json --target-repository operateBusiness
npm run loop -- route --json --request-text 'scan 任意问题'
npm run loop -- route --json --target-cwd $HOST/workspace/.local/t-max/mounts/repos/operateBusiness
npm run loop -- route --json; echo "exit=$?"
npm run loop -- help | grep -n "loop route"
npm run loop -- route --target-repository dcm

# ── 4. 宿主边界补充（TP-35/36）
node --input-type=module --eval 'import{isXiaobaiProjectContext}from"'$HOST'/workspace/host/xiaobai-host-scope.mjs";console.log(await isXiaobaiProjectContext(process.cwd(),process.cwd()+"/does/not/exist"));'
node --input-type=module --eval 'import{isXiaobaiProjectContext}from"'$HOST'/workspace/host/xiaobai-host-scope.mjs";console.log(await isXiaobaiProjectContext(process.cwd(),process.cwd()+"/workspace/projects/../.local"));'

# ── 5. 宿主入口（TP-40 ~ TP-46）
node workspace/host/t-max-xiaobai-entry.mjs --host-cwd $HOST --cwd $BIZ --message 'operateBusiness 任意消息'; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --cwd $BIZ --message 'operateBusiness 任意消息'; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --host-cwd /tmp --cwd $BIZ --message 'x'; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --host-cwd $HOST/workspace/.local --cwd $BIZ --message 'x'; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --host-cwd $HOST; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --foo bar; echo "exit=$?"
node workspace/host/t-max-xiaobai-entry.mjs --host-cwd $HOST --cwd /tmp; echo "exit=$?"

# ── 6. Codex 钩子（TP-50 ~ TP-60）
echo '{"cwd":"'$HOST'","prompt":"operateBusiness 巡检页需求"}' | node $HOOK; echo "exit=$?"
echo '{"cwd":"'$BIZ'","prompt":"operateBusiness 巡检页需求"}' | node $HOOK; echo "exit=$?"
echo '{"cwd":"'$HOST'/workspace/.local/t-max/mounts/repos/operateBusiness","prompt":"operateBusiness 需求"}' | node $HOOK; echo "exit=$?"
echo '{"prompt":"operateBusiness 需求"}' | node $HOOK; echo "exit=$?"
echo -n '' | node $HOOK; echo "exit=$?"
echo 'not-json' | node $HOOK; echo "exit=$?"
echo '{"cwd":"'$HOST'","prompt":"今天天气不错"}' | node $HOOK; echo "exit=$?"
time (echo '{"cwd":"'$HOST'","prompt":"operateBusiness 巡检页需求"}' | node $HOOK > /dev/null)
echo '{"cwd":"'$HOST'","prompt":"operateBusiness 巡检页需求"}' | /Users/seminzhu/.local/share/fnm/node-versions/v24.19.0/installation/bin/node $HOOK

# ── 7. 安装器隔离测试（TP-70 ~ TP-76，全部走临时 CODEX_HOME）
export CODEX_HOME=$(mktemp -d); echo "CODEX_HOME=$CODEX_HOME"
node workspace/host/install-codex-hook.mjs; echo "exit=$?"
cat $CODEX_HOME/hooks.json
node workspace/host/install-codex-hook.mjs; echo "exit=$? (幂等第二次)"
# 预置无关 hook + 旧小白 hook 后再跑，检查保留与替换
# 写入坏 JSON 后跑，检查 exit 2 且原文件未变

# ── 8. 边界与路径检查（TP-93/94）
unset CODEX_HOME
git status --short -uall
grep -rn "/Users/seminzhu" --include="*.ts" --include="*.mjs" --include="*.md" --include="*.yaml" . 2>/dev/null | grep -v "^./dist/" | grep -v "^./node_modules/" | head -20
```

English:

```bash
cd /Users/seminzhu/Documents/AI/xbaiProjectCode
HOST=$PWD
BIZ=/Users/seminzhu/Documents/ane/code/git/T-MAX/operateBusiness
HOOK=workspace/host/xiaoneng-codex-prompt-hook.mjs

# 0. Pre-flight protection: back up the real Codex config (Isolation Guardian)
cp ~/.codex/hooks.json /tmp/codex-hooks.backup.$(date +%H%M%S).json

# 1. Full unit tests (including the new host-routing test) — run in background to avoid SIGKILL
npm test

# 2. Targeted unit tests
node --test dist/loop-engineering/tests/host-routing.test.js
node --test dist/loop-engineering/tests/xiaoneng-context.test.js
node --test dist/loop-engineering/tests/runtime.test.js

# 3. CLI routing (TP-22 ~ TP-27) — see Chinese block
# 4. Host boundary supplements (TP-35/36) — see Chinese block
# 5. Host entry (TP-40 ~ TP-46) — see Chinese block
# 6. Codex hook (TP-50 ~ TP-60), including `time` and the fnm node run — see Chinese block
# 7. Installer isolation tests (TP-70 ~ TP-76) with a temporary CODEX_HOME — see Chinese block
# 8. Boundary and path checks (TP-93/94) — see Chinese block
```

执行约束 / Execution constraints:

中文：

- 第 7 节所有安装器用例**必须**带 `CODEX_HOME=<临时目录>`；任何情况下不向真实 `~/.codex` 写入。
- 第 0 节备份未完成时，不执行第 7 节。
- 不使用 `git stash`：当前工作区干净（除本计划），无基线混淆风险。
- 长时命令（`npm test`）以后台方式执行，避免被 SIGKILL。
- 涉及 git 的用例需关闭沙箱执行，否则 `.git/index.lock` 读写受限。

English:

- Every installer case in section 7 **must** set `CODEX_HOME=<temp dir>`; never write to the real `~/.codex`.
- Do not run section 7 until the section 0 backup succeeds.
- Do not use `git stash`: the working tree is clean (except this plan), so there is no baseline confusion.
- Run long commands (`npm test`) in the background to avoid SIGKILL.
- Git-touching cases need the sandbox disabled, otherwise `.git/index.lock` cannot be written.

---

## 8. 已知风险 / Known Risks

中文：

1. **设计取舍需确认（最高优先级）**：新模型下，业务仓目录内的 Codex 会话完全不受该 hook 影响（TP-52/TP-101）。如果用户日常是在 `Documents/ane/code/git/T-MAX/<repo>` 里开对话，这条链路不会生效。
2. **cwd 通道可能已死**：作用域排除 `workspace/.local`，而所有业务仓 cwd 命中路径都在其下。若 TP-24 证实 cwd 无法命中，则首标识是唯一入口，TP-01~TP-08 应全部升 P0。
3. **真实 Codex 配置已被修改**：`~/.codex/hooks.json` 于 16:06 被写入。测试前必须备份。
4. **钩子性能与 15 秒超时**：每次用户提交都同步执行完整路由，且 `dist` 缺失时会触发 `npm run build`。若 TP-58 测得耗时接近 15 秒，Codex 会判定 hook 超时，注入失败。
5. **跨 node 版本**：hook 注册的是 fnm `v24.19.0`，工程默认 `v22.22.2`，需 TP-60 验证一致性。
6. **小能版本偏差**：路由证据基于 `xiaoneng2.0` @ `0b54c3e`，不代表 3.0。
7. **方案文档滞后**：`t-max-xiaoneng-direct-routing-plan.md` 未覆盖 hook 与新宿主边界（TP-91）。
8. **沙箱 git 只读**：可能让 `taskContextLock.dirty` 假阳性（TP-82）。

English:

1. **Design trade-off needs confirmation (highest priority)**: under the new model, Codex conversations opened inside a business repository are entirely unaffected by this hook (TP-52/TP-101). If the user normally works in `Documents/ane/code/git/T-MAX/<repo>`, this chain never activates.
2. **The cwd channel may be dead**: the scope excludes `workspace/.local`, and every cwd-matching business path lives under it. If TP-24 confirms cwd cannot match, the leading marker is the only entrypoint and TP-01~TP-08 should all be promoted to P0.
3. **The real Codex config was already modified**: `~/.codex/hooks.json` was written at 16:06. Back it up before testing.
4. **Hook latency versus the 15-second timeout**: every user submit runs full routing synchronously, and a missing `dist` triggers `npm run build`. If TP-58 approaches 15 seconds, Codex treats the hook as timed out and injection fails.
5. **Cross node versions**: the hook registers fnm `v24.19.0` while the project defaults to `v22.22.2`; TP-60 must verify consistency.
6. **Xiaoneng version deviation**: routing evidence is based on `xiaoneng2.0` @ `0b54c3e` and does not represent 3.0.
7. **Plan doc lag**: `t-max-xiaoneng-direct-routing-plan.md` does not cover the hook or the new host boundary (TP-91).
8. **Read-only git in sandbox**: may produce a false-positive `taskContextLock.dirty` (TP-82).

---

## 9. 输出内容 / Deliverables

中文：

确认后产出测试报告 `loop-engineering/docs/testing/2026-09-04-tmax-xiaoneng-routing-test-report.md`：

```text
1. 执行摘要 / Summary        —— 通过/失败计数、结论（Go / No-Go）
2. 环境与版本 / Environment  —— commit、node 版本、小能 HEAD、hooks.json 快照
3. 执行记录 / Execution Log  —— 每条命令的实际输出（截断原文）+ 耗时
4. 结果矩阵 / Result Matrix  —— TP-01 ~ TP-101 逐条 Pass/Fail/Block/N-A + 证据行
5. Block 列表 / Blocks       —— 编号 | 描述 | 影响 | 解除条件
6. Defect 列表 / Defects     —— 编号 | P0/P1/P2 | 复现步骤 | 文件:行 | 建议修复
7. 风险实测 / Risk Findings  —— 第 8 节逐条确认结果（尤其风险 1、2、4）
8. 结论 / Verdict            —— 是否可进入提交评审；人工验证项清单
```

English:

After confirmation, produce the report `loop-engineering/docs/testing/2026-09-04-tmax-xiaoneng-routing-test-report.md`:

```text
1. Summary        —— pass/fail counts and verdict (Go / No-Go)
2. Environment    —— commit, node versions, Xiaoneng HEAD, hooks.json snapshot
3. Execution Log  —— verbatim (truncated) output per command plus latency
4. Result Matrix  —— TP-01 ~ TP-101 as Pass/Fail/Block/N-A with evidence lines
5. Blocks         —— id | description | impact | unblock condition
6. Defects        —— id | P0/P1/P2 | repro | file:line | suggested fix
7. Risk Findings  —— measured result per risk in section 8 (especially 1, 2, 4)
8. Verdict        —— whether commit review may start; list of manual verification items
```

---

## 10. 待确认项 / Confirmation Needed

中文：

1. **风险 1 是否可接受**：业务仓目录内的 Codex 对话被静默跳过（不注入小能锁），是预期设计，还是需要在业务仓侧另装一套 hook？
2. **是否备份并执行安装器隔离测试**：测试会备份 `~/.codex/hooks.json` 但绝不修改它（全部走临时 `CODEX_HOME`）。
3. **是否执行 TP-100/TP-101 人工验证**：需要你完全退出并重启 Codex Desktop，在真实对话里确认注入效果；我无法代跑。
4. **方案文档是否补写**：确认后是否把 hook 与新宿主边界补进 `t-max-xiaoneng-direct-routing-plan.md`（当前 P2 文档缺陷）。
5. **`emt` 挂载未登记**：是预期还是遗漏？

English:

1. **Is risk 1 acceptable**: Codex conversations inside business repositories are skipped silently (no Xiaoneng lock). Is that intended, or should a separate hook be installed on the business-repository side?
2. **Back up and run the isolated installer tests**: tests back up `~/.codex/hooks.json` but never modify it (all use a temporary `CODEX_HOME`).
3. **Run TP-100/TP-101 manual verification**: requires fully quitting and restarting Codex Desktop, then confirming injection in a real conversation; I cannot do that for you.
4. **Update the plan doc**: after confirmation, should I add the hook and the new host boundary to `t-max-xiaoneng-direct-routing-plan.md` (currently a P2 documentation defect)?
5. **`emt` mount unregistered**: expected or an omission?
