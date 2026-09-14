# T-MAX 子项目独立 xigua 路由迁移手册 / T-MAX Per-Project Xigua Routing Migration Runbook

## 1. 目的与范围 / Purpose And Scope

本手册用于在另一台电脑上，把 T-MAX 子项目逐步迁移到“小白内部按项目调用 xigua”的模式。第一轮只打通路由纵向切片，不生成 KPIUI 页面，不修改 T-MAX 业务源码，不依赖 DSH 中已安装的 xigua 插件。

This runbook migrates T-MAX repositories to a mode where Xiaobai invokes Xigua per project. The first round only establishes and proves the routing vertical slice. It does not generate the KPIUI page, modify T-MAX business source, or depend on an Xigua plugin installed in DSH.

目标链路：DSH 请求 -> 小白入口 -> 独立项目路由 -> xigua source-backed dispatch -> 只读需求读取 -> 路由证据返回。

Target path: DSH request -> Xiaobai entry -> independent project route -> Xigua source-backed dispatch -> read-only requirement intake -> route evidence result.

KPIUI、dcm 和其他项目必须拥有隔离上下文。t-max 可以保留为登记索引，但不能继续向任务注入共享业务背景或其他 T-MAX 仓库。

KPIUI, dcm, and other repositories must have isolated contexts. t-max may remain as a registration index, but it must not inject shared business context or other T-MAX repositories into a task.

## 2. 强制边界 / Mandatory Boundaries

1. 批次 A-D 不生成“简易流水管理”页面，不改 KPIUI 或 dcm 业务源码。
2. 批次 A-D 不删除 Xiaoneng 源码仓库、xigua 源码仓库或任何业务仓库。
3. DSH 已安装的 xigua 插件不属于本验证链路；必须证明 DSH 先进入小白，再由小白内部调用 xigua。
4. xigua 通过小白的 source-backed 能力加载，不要求安装到 KPIUI 项目级或系统级技能目录。
5. KPIUI 命中 xigua 后，不允许先进入小白原生页面技能，也不允许静默回退到 frontend-generator。
6. KPIUI 任务的允许仓库范围只能是 [KPIUI]；dcm 和其他 T-MAX 仓库必须在上下文之外。
7. 鸿蒙等不使用 xigua 的项目继续使用自己的 background / skill，xigua dispatch 次数必须为 0。
8. 只有批次 A-D 全部通过，才可进入批次 E。E 开始前必须重新展示具体删除清单与回滚方案，并取得当前消息明确确认。

1. Batches A-D must not generate the “简易流水管理” page or modify KPIUI or dcm business source.
2. Batches A-D must not delete the Xiaoneng source repository, the Xigua source repository, or any business repository.
3. The Xigua plugin installed in DSH is outside this path. Evidence must show DSH entering Xiaobai before Xiaobai invokes Xigua.
4. Xigua is loaded by Xiaobai as a source-backed capability; it is not installed into the KPIUI project or system skill directory.
5. A KPIUI route resolved to Xigua must skip native Xiaobai page skills and must not silently fall back to frontend-generator.
6. The only allowed repository scope for a KPIUI task is [KPIUI]; dcm and all other T-MAX repositories must be excluded.
7. Projects such as HarmonyOS that do not use Xigua keep their own background / skill, with Xigua dispatch count equal to 0.
8. Batch E may start only after all of Batches A-D pass. Before E, display the exact deletion list and rollback plan and obtain explicit confirmation in the current message.

## 3. 另一台电脑初始化 / Initialization On Another Computer

以下命令在 xbaiProjectCode 根目录执行。不要把本机真实路径、token、cookie、密码或私钥写入提交文件。

Run the following commands from the xbaiProjectCode root. Do not commit machine-specific paths, tokens, cookies, passwords, or private keys.

    git status --short -uall
    git branch --show-current
    git rev-parse --show-toplevel
    npm install

确认小白工程工作树干净，或先单独保存已有改动。工作树不干净时，不得覆盖用户改动。

Confirm that the Xiaobai worktree is clean, or save existing changes separately first. Do not overwrite user changes in a dirty worktree.

初始化本机路径配置：

Initialize local paths:

    cp workspace/projects/t-max/.loop/local.paths.yaml.example \
      workspace/projects/t-max/.loop/local.paths.yaml

在 ignored 的 local.paths.yaml 中填写真实路径：

Fill real paths in the ignored local.paths.yaml:

    background:
      xiaoneng: /absolute/path/to/xiaoneng
      xigua: /absolute/path/to/xigua
    repositories:
      KPIUI: /absolute/path/to/T-MAX/KPIUI
      dcm: /absolute/path/to/T-MAX/dcm
      max-console-ui: /absolute/path/to/T-MAX/max-console-ui
      max-operate-monitor-ui: /absolute/path/to/T-MAX/max-operate-monitor-ui
      operateBusiness: /absolute/path/to/T-MAX/operateBusiness
      operateSupport: /absolute/path/to/T-MAX/operateSupport
      scan: /absolute/path/to/T-MAX/scan

xigua 只作为小白读取的外部真源路径。不要执行 xigua 宿主链接安装脚本，也不要在 KPIUI 或系统级目录安装 xigua 作为本方案前置条件。

Xigua is only an external canonical source path read by Xiaobai. Do not run Xigua host-link installation, and do not install Xigua in KPIUI or at system level as a prerequisite.

## 4. 批次 A：项目拆分与挂载 / Batch A: Project Split And Mounts

为 KPIUI 创建独立 Project 配置，必须只声明一个目标仓和一个 xigua background：

Create an independent Project profile for KPIUI with one target repository and one Xigua background:

    kind: Project
    id: KPIUI
    name: KPIUI
    root: ../../.local/t-max/mounts/repos/KPIUI
    defaultBranch: master
    skill: SKILL.md
    localPaths: .loop/local.paths.yaml
    background:
      id: xigua
      name: xigua
      localPathKey: xigua
      mount: ../../.local/t-max/mounts/background/xigua
      runtime:
        type: skill-source
        provider: xigua
        entryPath: AGENT.md
    repositories:
      - id: KPIUI
        name: KPIUI
        localPathKey: KPIUI
        mount: ../../.local/t-max/mounts/repos/KPIUI
        remote: <KPIUI remote>

The profile must use Xigua's canonical AGENT.md as entryPath. Xiaobai may read it directly; the Xigua host-link requirement is ignored inside Xiaobai.

KPIUI 独立配置生效后，从旧 t-max 项目组仓库列表中移除 KPIUI，避免同时命中 t-max/KPIUI 和独立 KPIUI。其他仓库在本批次暂不迁移。

After the standalone profile is active, remove KPIUI from the legacy t-max repository list to avoid matching both t-max/KPIUI and standalone KPIUI. Other repositories remain on the legacy route in this batch.

执行挂载并核验：

Create mounts and verify them:

    npm run mount:tmax
    realpath workspace/.local/t-max/mounts/background/xigua
    realpath workspace/.local/t-max/mounts/repos/KPIUI
    test -f workspace/.local/t-max/mounts/background/xigua/AGENT.md

预期工程仓文件范围：

Expected engineering-repository file scope:

    workspace/projects/KPIUI/.loop/project.yaml                 new
    workspace/projects/KPIUI/SKILL.md                           new, bilingual
    workspace/projects/KPIUI/.loop/local.paths.yaml.example     new
    workspace/projects/t-max/.loop/project.yaml                 remove KPIUI legacy membership
    workspace/projects/t-max/.loop/local.paths.yaml.example     add xigua example
    workspace/projects/t-max/scripts/mount-local.mjs             add xigua mount

workspace/projects/t-max/.loop/local.paths.yaml 和 workspace/.local/ 是 ignored 本机状态，不得提交。A 批次不删除 Xiaoneng mount 软链接。

workspace/projects/t-max/.loop/local.paths.yaml and workspace/.local/ are ignored local state and must not be committed. Batch A does not delete the Xiaoneng mount symlink.

## 5. 批次 B：小白内部 xigua 运行时 / Batch B: Internal Xigua Runtime

B 批次的目标是让小白产生真实 xigua 执行计划，而不是只在文档里写出 xigua 字符串。

The goal of Batch B is for Xiaobai to produce a real Xigua execution plan, not merely to place the string xigua in documentation.

预期运行时文件范围：

Expected runtime file scope:

    loop-engineering/packages/shared/src/types.ts
    loop-engineering/packages/project-registry/src/projectRegistry.ts
    loop-engineering/packages/skill-runtime/src/skillRuntime.ts
    loop-engineering/packages/loop-runtime/src/loopRuntime.ts
    loop-engineering/cli/loop.ts
    loop-engineering/packages/xigua-context-runtime/src/xiguaContextRuntime.ts  new
    loop-engineering/packages/xigua-context-runtime/src/index.ts                new

必须实现：

Required behavior:

1. ProjectExecutor 支持 xigua。
2. xigua background 明确 provider=xigua 和 entryPath=AGENT.md。
3. KPIUI 的 projectScopeRepositories 只能是 [KPIUI]。
4. resolver 读取 xigua 真源 AGENT.md，并记录入口路径、hash、source root 和消费时间。
5. source root、入口文件或目标仓缺失时失败关闭，不能回退到小白原生页面技能。
6. KPIUI xigua route 跳过 worktree、generator、evaluator 和业务写入。
7. AGENT.md 是 xigua 规范真源；宿主链接要求不是小白内部 route 前置条件。

1. ProjectExecutor supports xigua.
2. The Xigua background explicitly declares provider=xigua and entryPath=AGENT.md.
3. KPIUI projectScopeRepositories is exactly [KPIUI].
4. The resolver reads canonical AGENT.md and records entry path, hash, source root, and consumption time.
5. Missing source root, entry file, or target repository fails closed without fallback to native Xiaobai page skills.
6. A KPIUI Xigua route skips worktree, generator, evaluator, and business writes.
7. AGENT.md is the Xigua canonical source; host linking is not a prerequisite for an internal Xiaobai route.

新增测试至少覆盖：

New tests must cover at least:

    KPIUI explicit project route -> Project / KPIUI / [KPIUI] / xigua
    KPIUI leading repository marker -> Project / KPIUI / [KPIUI] / xigua
    KPIUI scope excludes dcm and all other T-MAX repositories
    missing xigua source -> fail closed
    xigua route -> native Xiaobai page skill skipped
    HarmonyOS route -> xigua dispatch absent
    unknown target -> fail closed with no fallback

旧 t-max -> xiaoneng 测试可以保留为兼容性回归，但不能作为 xigua 验收证据。

Legacy t-max -> xiaoneng tests may remain as compatibility regression tests, but they cannot serve as Xigua acceptance evidence.

## 6. 批次 C：DSH 到小白独占入口 / Batch C: Exclusive DSH-To-Xiaobai Entry

C 批次修复附件日志中的第一个断点：DSH 必须先进入小白。DSH 自己的 xigua 插件不参与此路径。

Batch C fixes the first break shown in the attached log: DSH must enter Xiaobai first. DSH's own Xigua plugin is outside this path.

~/.codex/hooks.json 或等价宿主配置只负责把原始请求转交给小白，不直接选择 xigua，不直接读取 dcm，不直接生成页面。

~/.codex/hooks.json, or the equivalent host configuration, only forwards the raw request to Xiaobai. It must not select Xigua directly, read dcm directly, or generate a page directly.

入口逻辑：

Entry logic:

    host hook receives request
      -> call Xiaobai with raw request and host trace id
      -> Xiaobai resolves target project
      -> Xiaobai applies exclusive executor selection
      -> KPIUI target enters Xigua

如果不能证明 xiaobai.entry.invoked，必须停止并返回 XIAOBAI_ENTRY_UNAVAILABLE，不得继续执行 xigua 或页面生成。

If xiaobai.entry.invoked cannot be proven, stop with XIAOBAI_ENTRY_UNAVAILABLE and do not continue to Xigua or page generation.

当项目绑定 xigua 时，路由选择必须先于任何页面技能读取：

When a project is Xigua-bound, route selection must finish before any page skill is read:

    target project is Xigua-bound
      -> executor = xigua
      -> skip Xiaobai native page skill
      -> skip frontend-generator
      -> no silent fallback

不使用 xigua 的项目继续使用自己的 background / skill，且不加载 xigua。

Projects that do not use Xigua keep their own background / skill and do not load Xigua.

## 7. 批次 D：真实路由与隔离验收 / Batch D: Real Routing And Isolation Acceptance

在 DSH 或 DeepSeekHarness 中发送以下请求，只执行到需求读取和路由返回，不落业务代码：

Send the following request in DSH or DeepSeekHarness. Stop after requirement intake and route output; do not write business code:

    在 KPIUI 项目里，新增一个“简易流水管理”页面，在 KPI 一级目录下，需求地址：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae

同一 trace id 下必须按顺序出现：

Under one trace id, these events must appear in order:

    dsh.request.received
    xiaobai.entry.invoked
    project.route.resolved project=KPIUI targetRepository=KPIUI
    xigua.dispatch.started count=1
    xigua.entry.read entry=AGENT.md
    xigua.requirement.intake.started
    xigua.dispatch.completed count=1
    xiaobai.native.page.skill skipped
    target.write skipped

出现以下任一情况，D 批次失败：缺少 xiaobai.entry.invoked；DSH 直接调用 xigua；出现 frontend-generator；出现原生页面技能；读取 dcm 或其他 T-MAX 仓库；xigua dispatch 次数大于 1；出现 KPIUI 业务写入。

Batch D fails if xiaobai.entry.invoked is missing; DSH calls Xigua directly; frontend-generator appears; a native page skill starts; dcm or another T-MAX repository is read; Xigua dispatch occurs more than once; or KPIUI business source is written.

小白 route-only 命令：

Xiaobai route-only command:

    npm run build --silent
    node dist/loop-engineering/cli/loop.js route \
      --loop frontend-delivery \
      --target-project KPIUI \
      --request-text '在 KPIUI 项目里，新增一个“简易流水管理”页面，在 KPI 一级目录下，需求地址：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae' \
      --json

输出必须表达：

The output must express:

    host = xiaobai
    project = KPIUI
    projectKind = Project
    targetRepository = KPIUI
    projectScopeRepositories = [KPIUI]
    background = xigua
    executor = xigua
    write = none

如果输出仍为 t-max、xiaoneng、7 个仓库或 xiaobai 原生 executor，立即停止，不进入页面任务。

If the output still resolves to t-max, xiaoneng, seven repositories, or the native Xiaobai executor, stop immediately and do not start the page task.

反向隔离用例：

Negative isolation cases:

    KPIUI request -> KPIUI -> xigua, dispatch 1, dcm excluded
    dcm request -> dcm -> xigua, KPIUI excluded
    HarmonyOS request -> HarmonyOS own background / skill, xigua dispatch 0
    unknown target -> fail closed, no fallback executor
    missing xigua source -> explicit failure, no native page fallback

只有真实 trace 同时证明 DSH 进入小白、xigua dispatch、入口读取、需求读取、隔离结果和写入次数，D 批次才算通过。配置存在、单测通过或 DSH 有 xigua 插件都不能替代真实 provider 消费证据。

Batch D passes only when a real trace proves DSH entry into Xiaobai, Xigua dispatch, entry reading, requirement reading, isolation, and write count. Configuration, passing unit tests, or an Xigua plugin in DSH cannot substitute for real provider-consumption evidence.

工程仓边界检查：

Engineering-repository boundary checks:

    git status --short -uall
    git diff --check
    git diff --name-only

工程仓 diff 不得包含 workspace/.local/、workspace/workspace.local.yaml、任意 local.paths.yaml、KPIUI/dcm 业务源码、xiaoneng 源码内容或 xigua 源码内容。

The engineering diff must not contain workspace/.local/, workspace/workspace.local.yaml, any local.paths.yaml, KPIUI/dcm business source, Xiaoneng source contents, or Xigua source contents.

## 8. 批次 E：Xiaoneng 删除 / Batch E: Xiaoneng Deletion

E 不得与 A-D 混在一次操作中。A-D 通过后，先停止，重新读取工作树和挂载状态，再展示最终删除清单。

E must not be combined with A-D. After A-D passes, stop, re-read the worktree and mount state, then display the final deletion list.

以下是候选对象，不是当前授权的删除清单：

The following are candidate targets, not currently authorized deletion targets:

    [DESTRUCTIVE] workspace/.local/t-max/mounts/background/xiaoneng
                  Xiaoneng mount symlink only; never delete the Xiaoneng source repository.

    [CONFIG EDIT] workspace/projects/t-max/.loop/project.yaml
                  Remove the legacy Xiaoneng background and shared scope only after every
                  active T-MAX child project has an independent route.

    [LOCAL EDIT] workspace/projects/t-max/.loop/local.paths.yaml
                  Remove the xiaoneng local-path entry only after no active route uses it.

    [DOC REVIEW] workspace/projects/t-max/SKILL.md
                  Remove or replace legacy Xiaoneng entry instructions only after all
                  route consumers are migrated; retain unrelated project rules.

不得删除：

Do not delete:

    /absolute/path/to/xiaoneng source repository
    /absolute/path/to/xigua source repository
    any KPIUI, dcm, or other T-MAX business repository
    any DSH or Codex user-data directory

### E1. 删除前确认 / Pre-Deletion Confirmation

执行人必须重新展示每一个实际删除或修改对象的绝对路径、操作类型、删除前状态、A-D route matrix 结果和逐文件回滚命令，然后原样询问：

The operator must display every actual deletion or edit target with its absolute path, operation type, pre-deletion state, A-D route-matrix result, and per-file rollback command, then ask exactly:

    只有批次 A-D 的路由和隔离验证通过后，才进入批次 E 的 Xiaoneng 删除。
    删除批次前我会再次展示具体文件清单和回滚方案。
    其中批次 E 和 xiaoneng mount 软链接移除属于删除/不可逆操作。
    确认执行以上操作？(yes/no)

只有当前消息明确回复 yes 才授权 E。之前的方案确认、另一台电脑的测试结果或 DSH 插件状态都不能代替这次确认。

Only an explicit yes in the current message authorizes E. Prior plan approval, test results from another computer, or DSH plugin state is not a substitute.

### E2. 删除后验收 / Post-Deletion Acceptance

    git status --short -uall
    realpath workspace/.local/t-max/mounts/background/xigua
    test ! -e workspace/.local/t-max/mounts/background/xiaoneng
    node dist/loop-engineering/cli/loop.js route --loop frontend-delivery --target-project KPIUI --json

删除前必须在当前消息取得明确 `yes`，然后仅对已展示的清单执行带删除开关的挂载命令：

    XIAOBAI_ALLOW_STALE_BACKGROUND_MOUNT_REMOVAL=1 npm run mount:tmax

普通 `npm run mount:tmax` 只刷新声明的挂载，不删除未声明的旧背景软链接。删除后必须确认 KPIUI 仍为 KPIUI -> xigua，dcm 仍为独立 dcm -> xigua，鸿蒙仍然不调用 xigua，且没有任务回退到小白原生页面技能。

After explicit `yes` in the current message, run the removal command only for the displayed target list:

    XIAOBAI_ALLOW_STALE_BACKGROUND_MOUNT_REMOVAL=1 npm run mount:tmax

A normal `npm run mount:tmax` only refreshes declared mounts and does not delete undeclared legacy backgrounds. After deletion, confirm that KPIUI remains KPIUI -> xigua, dcm remains independent dcm -> xigua, HarmonyOS still does not call Xigua, and no task falls back to a native Xiaobai page skill.

## 9. 回滚方案 / Rollback Plan

A-D 是工程仓代码、配置和 ignored 软链接变更，不涉及业务源码。每批次结束保存：

A-D changes engineering code, configuration, and ignored symlinks only; business source is out of scope. Save:

    git diff --no-ext-diff > /tmp/xbai-xigua-routing-YYYYMMDD-HHMMSS.patch
    git status --short -uall

回滚前必须确认 patch 对应的工作树基线，不能对含有用户已有改动的工作树执行宽范围恢复。优先使用独立分支或人工审阅后的反向 patch，逐个文件恢复。

Before rollback, confirm the worktree baseline represented by the patch. Never perform a broad restore on a worktree containing user changes. Prefer a separate branch or a human-reviewed reverse patch, restoring files one by one.

E 批次的软链接删除可以通过明确恢复目标后，使用 `ln -s /absolute/path/to/xiaoneng workspace/.local/t-max/mounts/background/xiaoneng` 单独重建 mount；仅恢复 local.paths.yaml 不会触发普通挂载刷新删除或重建未声明的旧背景。工程仓配置删除或修改使用 E 批次前保存的逐文件 patch 或 VCS checkpoint 恢复。Xiaoneng 源码仓库在 E 批次中不删除。

The Batch E symlink deletion can be reversed by explicitly restoring the target and running `ln -s /absolute/path/to/xiaoneng workspace/.local/t-max/mounts/background/xiaoneng`; restoring local.paths.yaml alone does not make a normal mount refresh delete or recreate an undeclared legacy background. Restore engineering configuration edits from the per-file patch or VCS checkpoint saved before E. The Xiaoneng source repository is not deleted in E.

## 10. 最终判定 / Final Disposition

以下条件全部满足才可以进入页面任务：

The page task may start only when every condition below is satisfied:

    [ ] DSH 真实进入小白 / DSH actually entered Xiaobai
    [ ] KPIUI 独立 Project 路由命中 / standalone KPIUI Project matched
    [ ] KPIUI scope 只有 KPIUI / KPIUI is the only scoped repository
    [ ] xigua dispatch 真实发生且恰好一次 / one real Xigua dispatch occurred
    [ ] xigua 读取 AGENT.md 真源 / Xigua read canonical AGENT.md
    [ ] Yuque 需求只读消费 / Yuque requirement was read-only consumed
    [ ] Xiaobai native page skill 未调用 / native page skill was not called
    [ ] frontend-generator 未调用 / frontend-generator was not called
    [ ] dcm 和其他 T-MAX 仓库未读取 / dcm and other T-MAX repos were not read
    [ ] 鸿蒙 xigua dispatch = 0 / HarmonyOS Xigua dispatch equals zero
    [ ] unknown target fail-closed / unknown target failed closed
    [ ] route-only 阶段没有业务仓写入 / no business-repository write in route-only phase
    [ ] 工程仓 diff 边界通过 / engineering diff boundary passed

任一项没有运行证据，都标记为 NO-GO，停止页面生成和 Xiaoneng 删除。不能把“配置已写好”“单测通过”“宿主有 xigua 插件”或“看到了 dcm 参考页面”当作 xigua 已被小白真实调用的证明。

If any item lacks execution evidence, mark the result NO-GO and stop both page generation and Xiaoneng deletion. Do not treat configuration, passing unit tests, an Xigua plugin in DSH, or a dcm reference page as proof that Xiaobai actually invoked Xigua.
