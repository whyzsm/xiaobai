# Frontend Delivery Skill / 前端交付技能

## 中文

## 目标

把一个前端需求从输入来源推进到可交付 PR，但必须先完成前端技术设计方案、独立设计评审和 `human-design-approval`。

输入来源包括：

- 本地上传文档
- 对话手动输入
- 语雀链接或语雀 API

## 硬门禁

1. 未生成主设计文档和各目标仓补充分设计文档时，不得进入编码。
2. 未通过独立 evaluator 的 `frontend-design-review-passed` 时，不得进入编码。
3. 未记录用户确认的 `human-design-approval` 时，不得进入编码。
4. 业务设计正文和业务代码不得写入工程仓，只能写入当前动态挂载的目标前端仓。
5. 目标仓必须来自当前动态挂载清单，未挂载仓不得写入。
6. merge、release、外部接口契约变更、重大依赖升级和破坏性文件操作必须停在人工门禁。

## 工作流程

V2 使用显式 `workflow.stages[]` 表达阶段顺序：

1. `requirement-intake`：读取本地文档、对话输入和语雀 Yuque 来源，生成可追溯的需求摘要。
2. `target-repository-resolution`：动态扫描当前挂载的目标前端仓，识别主目标仓和参与开发仓；无法确认时写入 inbox。
3. `frontend-master-design`：在主目标仓生成主设计文档，优先复用已有文档目录，没有文档目录时使用 `docs/frontend-design/`。
4. `frontend-repository-design`：在每个参与仓生成仓内补充分设计文档。
5. `frontend-design-review`：独立 evaluator 审查设计，输出审核报告。
6. `human-design-approval`：等待用户确认；该阶段是人工授权，不得由 evaluator 替代。
7. `frontend-implementation`：只有确认后，才允许进入编码计划。
8. `implementation-verification`：验证 lint、测试、构建和 UI smoke 证据。
9. `pr-readiness`：准备 PR-ready 摘要、风险和回滚建议。

## 能力边界

- `workflow.stages[].status: planned` 只代表计划，不代表已经执行。
- V2 增加语雀 API 配置结构，不启用真实 API 调用。
- `pr-readiness` 表示 PR 材料就绪，不等于已经创建、推送或合并 PR。
- 不要从 planned stage 推断已经创建分支、调用语雀、写目标仓或创建 PR。

## 设计方案必须包含

- 页面布局
- 组件清单
- 交互流程
- 空态、加载态、错误态、禁用态和权限态
- 无障碍设计
- 高效扫查设计
- 数据与接口
- 实现切分
- 测试与验收策略
- 风险与待确认项

## English

## Purpose

Move a frontend requirement from intake to a PR-ready delivery, but only after frontend technical design, independent design review, and `human-design-approval` are complete.

Supported inputs:

- Local uploaded documents
- Manual conversation input
- Yuque links or Yuque API

## Hard Gates

1. The loop must not enter implementation before the master design document and every target repository supplement exist.
2. The loop must not enter implementation before the independent evaluator passes `frontend-design-review-passed`.
3. The loop must not enter implementation before user-confirmed `human-design-approval` is recorded.
4. Business design bodies and business code must not be written to the engineering repository. They belong only in currently dynamic mounted target frontend repositories.
5. Target repositories must come from the current dynamic mounted repository list. Unmounted repositories are not writable.
6. Merge, release, external API contract changes, major dependency upgrades, and destructive file changes must stop at human gates.

## Workflow

V2 uses explicit `workflow.stages[]` to express stage order:

1. `requirement-intake`: read local documents, conversation input, and Yuque sources, then produce a traceable requirement brief.
2. `target-repository-resolution`: dynamically scan mounted target frontend repositories, identify the primary target repository and participating repositories, and write unclear choices to the inbox.
3. `frontend-master-design`: write the master design document in the primary target repository. Prefer an existing docs directory; use `docs/frontend-design/` when no docs directory exists.
4. `frontend-repository-design`: write repository design supplements in every participating repository.
5. `frontend-design-review`: have an independent evaluator review the design and produce a review report.
6. `human-design-approval`: wait for user confirmation. This is a human authorization stage and must not be replaced by evaluator approval.
7. `frontend-implementation`: allow implementation planning only after approval.
8. `implementation-verification`: verify lint, tests, build, and UI smoke evidence.
9. `pr-readiness`: prepare the PR-ready summary, risks, and rollback guidance.

## Capability Boundaries

- `workflow.stages[].status: planned` means planned only, not executed.
- V2 adds Yuque API configuration shape, not real API execution.
- `pr-readiness` means PR material readiness, not a created, pushed, or merged PR.
- Do not infer branch creation, Yuque fetch, target repository writes, or PR creation from a planned stage.

## Required Design Content

- Page layout
- Component inventory
- Interaction flow
- Empty, loading, error, disabled, and permission states
- Accessibility design
- Efficient scanning design
- Data and APIs
- Implementation breakdown
- Testing and acceptance strategy
- Risks and open questions
