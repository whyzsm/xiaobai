# Frontend Design Review Skill / 前端设计评审技能

## 中文

## 目标

独立审查主设计文档和各仓补充设计文档，输出审核报告。审核通过不等于可以编码；必须等待用户确认 `human-design-approval`。

在 V2 中，`frontend-design-review` 和 `human-design-approval` 是两个独立 `workflow.stages[]` 阶段。`frontend-design-review` 只能给出 PASS/REJECT 和审核报告，不能替用户授权进入 `frontend-implementation`。

## 审查清单

1. 需求来源是否可追溯：本地文档、对话输入或语雀 Yuque。
2. 主目标仓和参与仓是否来自当前动态挂载清单。
3. 主设计文档是否覆盖页面布局、组件清单、交互流程、无障碍设计和高效扫查设计。
4. 每个参与仓是否有补充设计文档。
5. 补充设计是否包含页面与路由、组件、接口、状态、测试策略和实现切分。
6. 是否明确空态、加载态、错误态、禁用态、权限态。
7. 是否存在业务设计正文或业务代码写入工程仓的风险。
8. 是否存在认证、权限、支付、数据删除、重大依赖升级或外部接口契约变更，需要升级人工复核。

## 输出

- `PASS` 或 `REJECT`
- 设计审核报告路径
- 阻塞问题
- 可后置问题
- 是否允许提交给用户做 `human-design-approval`

## English

## Purpose

Independently review the master design document and repository supplements, then produce a review report. Passing review does not authorize implementation; implementation must still wait for user-confirmed `human-design-approval`.

In V2, `frontend-design-review` and `human-design-approval` are separate `workflow.stages[]` stages. `frontend-design-review` can only produce PASS/REJECT and a review report; it cannot authorize entry into `frontend-implementation` on behalf of the user.

## Review Checklist

1. Requirement source is traceable: local document, conversation input, or Yuque.
2. The primary target repository and participating repositories come from the current dynamic mounted repository list.
3. The master design covers page layout, component inventory, interaction flow, accessibility, and efficient scanning.
4. Every participating repository has a design supplement.
5. Each supplement covers pages and routes, components, APIs, states, testing strategy, and implementation breakdown.
6. Empty, loading, error, disabled, and permission states are explicit.
7. There is no risk of writing business design bodies or business code into the engineering repository.
8. Authentication, permission, payment, data deletion, major dependency upgrades, or external API contract changes are escalated to human review.

## Output

- `PASS` or `REJECT`
- Design review report path
- Blocking issues
- Deferrable issues
- Whether the design is ready for user `human-design-approval`
