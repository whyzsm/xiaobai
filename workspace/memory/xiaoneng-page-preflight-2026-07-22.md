# Xiaoneng Page Preflight Architecture / 小能页面预检架构

## Scope / 范围

本次在 `/Users/seminzhu/Documents/AI/xiaoneng` 的 `xiaoneng2.0` 分支完成轻量页面生成链路改造，目标是让标准页、多 Tab 和看板页面统一经过 artifact、组件机器门禁和页面结构双门禁，不增加正式 Agent。

This change set updated the `xiaoneng2.0` branch in `/Users/seminzhu/Documents/AI/xiaoneng`. The goal was to route standard, multi-tab, and dashboard pages through a lightweight artifact, machine component gate, and two-phase page structure gate without adding formal Agents.

## Architecture / 架构

统一链路为：需求意图 -> ignored `page-contract.json` -> `componentAvailabilityGate` -> `pageStructureGate.plan` -> Watermelon 一次落码 -> `pageStructureGate.implementation` -> 轻量交付自检。只有顶层 `reasonCode=unknownComponent` 才允许 Orange 最多调用一次，Orange 不能签发最终 gate，机器必须重新校验。

The unified flow is: request intent -> ignored `page-contract.json` -> `componentAvailabilityGate` -> `pageStructureGate.plan` -> one Watermelon implementation pass -> `pageStructureGate.implementation` -> lightweight delivery checks. Only top-level `reasonCode=unknownComponent` may trigger one Orange call; Orange cannot issue the final gate and the machine must re-check.

正式 Agent 数量保持为 5，禁止页面 Agent、门禁 Agent、监督 Agent 注册到运行时，禁止 Agent 调 Agent，Skill 保持单 owner。四种轻量页面类型的默认实现 owner 都是 `watermelon-frontend-agent`，`requiresStageArtifacts` 保持为 `false`。

The formal Agent count remains five. Page, gate, and supervisor Agents are not registered at runtime; Agents cannot call Agents; and each Skill has one owner. All four lightweight page types default to `watermelon-frontend-agent`, with `requiresStageArtifacts` remaining `false`.

## Implemented Gates / 已实现门禁

新增 canonical lightweight contract schema、component decision schema、runtime preflight、component resolver、page structure validator，以及标准页、多 Tab、看板、Drawer/Modal CRUD 的正负 fixture。contract 文件均不超过 2048 bytes，当前最大值为 2012 bytes。

The canonical lightweight contract schema, component decision schema, runtime preflight, component resolver, page structure validator, and positive/negative fixtures for standard, multi-tab, dashboard, and drawer/modal CRUD pages are in place. Every contract is at most 2048 bytes; the current maximum is 2012 bytes.

多 Tab 页面现在要求父级是真实 `MainContainer + Tabs + TabPane` 壳，每个 Tab 独立拥有页面、查询、列表、列、model、service 和独立导出职责。看板区域有独立目录和 model/service，父级只编排区域与间距。Drawer/Modal 的每个声明 overlay 都必须有组件声明、registry/source/import、JSX 和 export 证据。

Multi-tab pages now require a real `MainContainer + Tabs + TabPane` shell, with each Tab owning its page, search, table, columns, model, service, and independent export responsibilities. Dashboard regions have independent directories and model/service files; the parent only composes regions and spacing. Every declared Drawer/Modal overlay must provide component, registry/source/import, JSX, and export evidence.

## Verification / 验证

在 Node 22.20.0 下，`node harness/scripts/validate-all.mjs` 和 `./scripts/validate-release-assurance.sh` 均通过。结果包括 16 项 validate 检查通过、architecture scorecard `Go 14/14`、30 个页面结构 cases、44 个 runtime CLI cases、5 个 page absorption cases、3 个派生 artifact 无漂移，以及 skill、Agent、governance 和 portability 检查通过。

Under Node 22.20.0, both `node harness/scripts/validate-all.mjs` and `./scripts/validate-release-assurance.sh` passed. The results include all 16 validation checks, architecture scorecard `Go 14/14`, 30 page structure cases, 44 runtime CLI cases, 5 page absorption cases, three derived artifacts with no drift, and passing Skill, Agent, governance, and portability checks.

The standalone Xiaoneng checkout has no `package.json` scripts for `validate` or `test`; therefore `npm run validate` and `npm test` returned `Missing script`. The repository-native `validate-all` and release assurance entrypoints were used instead. No T-MAX business build was run.

独立 Xiaoneng 仓库没有 `package.json`，因此不存在 `validate` 和 `test` npm script；`npm run validate` 与 `npm test` 实际返回 `Missing script`。改用仓库原生 `validate-all` 和 release assurance 入口完成等价验证，没有执行 T-MAX 业务构建。

为兼容 Node 16/22，测试 evaluator 的 JSON 深拷贝不再依赖 `structuredClone`，并修正了 fixture portability 误报以及组件门禁阶段缺失 contract 时的 stop code。architecture scorecard 通过生成脚本刷新。

For Node 16/22 compatibility, evaluator JSON deep copies no longer depend on `structuredClone`; a fixture portability false positive and the component-gate stop code for a missing contract were also corrected. The architecture scorecard was refreshed through its generator.

## Performance Boundary / 性能边界

CPYYZ-6693 和 CPYYZ-6694 各执行了 3 次 machine-gate fixture replay，CPYYZ-6699 明确排除。CPYYZ-6693 的 preflight P50/P90 为 91.089/91.118 ms，最大单 gate 为 46.826 ms，首轮结构正确率为 1，返工次数为 0。CPYYZ-6694 的 preflight P50/P90 为 84.821/87.199 ms，最大单 gate 为 42.715 ms，首轮结构正确率为 1，返工次数为 0。

Three machine-gate fixture replays were run for each of CPYYZ-6693 and CPYYZ-6694, with CPYYZ-6699 explicitly excluded. CPYYZ-6693 had preflight P50/P90 of 91.089/91.118 ms, a maximum single gate of 46.826 ms, first-structure correctness of 1, and zero rework. CPYYZ-6694 had preflight P50/P90 of 84.821/87.199 ms, a maximum single gate of 42.715 ms, first-structure correctness of 1, and zero rework.

仓库当前没有真实页面生成 replay runner，也没有可观测的原始需求生成 tokens、tool calls 或生成分钟数。因此这些指标没有伪造，完整页面生成性能基线仍需后续接入真实生成执行器后回放。

The repository currently has no full page-generation replay runner and no observable source for raw-request generation tokens, tool calls, or generation minutes. These metrics were not fabricated; the full page-generation performance baseline still requires a real generation executor.

## Git Boundary / Git 边界

当前分支为 `xiaoneng2.0`，与 `origin/xiaoneng2.0` 的 ahead/behind 为 `0/0`；本次改动未提交、未推送，业务仓库没有被构建或修改。

The current branch is `xiaoneng2.0`, with ahead/behind parity `0/0` against `origin/xiaoneng2.0`. These changes were not committed or pushed, and no business repository was built or modified.
