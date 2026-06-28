# 产品需求平台规范 / Product Requirement Platform Standards

## 中文

## 目标

本规范把 PM Master 类产品管理技能沉淀为 Loop Engineering 工程仓的平台级需求规范，用于约束需求输入、PRD、详细设计输入、优先级、指标、风险、发布说明和实现验收。

它不是产品方法论大全，也不是让 agent 机械套用所有框架。平台规范只保留能直接支撑 loop 发现、设计门禁、编码交付、独立评审和 memory 沉淀的产品规则。

## 适用范围

本规范适用于进入本工程仓的产品需求、前端交付 loop、项目级 `SKILL.md`、设计文档、需求评审、实现验收和发布说明。

当需求来自语雀、本地文档、对话输入、Issue、Jira 或 memory 时，agent 必须先把需求规范化为可验证输入，再进入设计或实现阶段。缺少关键产品事实时，不允许用实现假设替代产品确认。

## 产品输入原则

1. 需求必须解释用户痛点和业务目标，不能只描述功能方案。
2. 需求必须明确目标用户、使用场景、范围边界、验收标准和成功指标。
3. 需求必须区分事实、假设、待确认项和暂不处理项。
4. 进入编码前，需求必须能被测试、评审或人工门禁验证。
5. 需求文档应服务于交付闭环，不为展示方法论而堆叠框架。

## 需求澄清

需求进入 loop 时，先回答以下问题：

| 问题 | 输出 |
|------|------|
| 用户是谁？ | 目标角色、权限、使用频率 |
| 当前痛点是什么？ | 现有绕路方式、业务影响、失败成本 |
| 为什么现在做？ | 目标、时机、约束、外部触发 |
| 做到什么程度算完成？ | 可观察验收标准和指标 |
| 本次不做什么？ | Out of scope、后置项、明确取舍 |
| 有哪些风险？ | 业务、体验、技术、数据、安全和依赖风险 |

如果问题影响接口字段、权限、页面结构、核心流程或数据口径，必须标为待确认，并在 `inbox`、设计评审或人工门禁中保留。

## 需求分析方法

选择最少够用的分析框架：

- `5W1H`：用于快速澄清角色、场景、动机、范围和实现约束。
- `JTBD`：用于从用户提出的方案回到真实任务、社交诉求和情绪压力。
- `Y 模型`：用于从 What 追问 Why，再重构 How。
- `KANO`：用于区分必备、期望、兴奋和无差异需求。
- `机会解决方案树`：用于复杂探索，把目标、机会、方案和实验分开。

禁止为了显得完整而同时套用所有框架。每个被采用的框架都必须产生明确结论，进入范围、优先级、设计或验收。

## 伪需求识别

对以下需求保持谨慎：

- 用户直接指定实现方案，但没有说明背后的任务和痛点。
- 只代表单个用户偏好，缺少角色或群体证据。
- 无法说明业务价值、指标变化或失败成本。
- 只增加配置、灵活性或视觉细节，却不能改变用户行为或交付结果。
- 与现有权限、数据口径、设计门禁或项目边界冲突。

处理方式：

1. 追问为什么，回到用户要完成的任务。
2. 查找现有行为、数据、访谈、工单或 memory 证据。
3. 用最小实验、MVP、灰度或人工确认验证。
4. 无法验证时，不进入 Must 范围。

## PRD 最小结构

进入设计或实现前，PRD 至少包含：

```markdown
# [需求名称] PRD

## 1. 背景与目标
- 用户痛点：
- 业务目标：
- 成功指标：

## 2. 目标用户与场景
- 角色：
- 使用场景：
- 当前绕路方式：

## 3. 范围
- Must：
- Should：
- Not now：
- Out of scope：

## 4. 用户故事
- 作为 [角色]，我想要 [操作]，以便 [价值]。

## 5. 核心流程
1. ...
2. ...
3. ...

## 6. 验收标准
1. 可观察行为：
2. 数据校验：
3. 权限与异常：
4. 空态、加载态、失败态：

## 7. 指标与埋点
- 业务指标：
- 行为事件：
- 数据来源：

## 8. 风险与待确认
- 风险：
- 待确认项：
- 依赖：
```

完整 PRD 可以扩展版本记录、价值主张、详细模块、非功能需求、数据埋点和风险矩阵，但不得缺失最小结构。

## 用户故事

用户故事必须符合 INVEST：

- 独立：能独立评审和交付。
- 可协商：允许设计和工程共同优化方案。
- 有价值：能解释用户或业务收益。
- 可估算：范围足够清晰。
- 足够小：适合一个交付切口。
- 可测试：有明确验收标准。

推荐格式：

```text
作为 [用户角色]，我想要 [操作或能力]，以便 [用户或业务价值]。
```

验收标准必须描述可观察行为，不写“体验更好”“尽量快”“支持一下”这类不可验证表述。

## 详细设计输入

PRD 进入详细设计时，必须提供足够输入让设计和工程不靠猜：

- 核心业务对象、字段、权限、状态和对象关系。
- 主流程、异常流程、逆向流程和后置状态。
- 数据来源、接口权威方、埋点事件和指标计算口径。
- 非功能需求：性能、安全、兼容性、可用性、可靠性。
- 设计门禁：哪些变更必须经过产品、设计、工程或人工审批。

如果详细设计发现 PRD 输入不足，应回到需求澄清，而不是直接补实现假设。

## 优先级

优先级框架按场景选择：

| 场景 | 推荐框架 |
|------|----------|
| 早期探索或证据较少 | ICE |
| 有触达人数、影响和工作量数据 | RICE |
| 需求分类和 MVP 边界 | KANO |
| Sprint 范围管理 | MoSCoW |
| 快速方案取舍 | 价值 / 工作量矩阵 |

优先级结论必须写明依据和置信度。`Must` 只能放入没有它就无法形成闭环或无法满足安全、权限、合规、核心体验的内容。

## 指标体系

每个需求至少定义一个成功指标和一个防护指标。

好指标应满足：

- 易理解：团队能形成共同语言。
- 可比较：能随时间、群体或版本比较。
- 有明确口径：公式、数据源和统计窗口清楚。
- 能改变行为：指标变化会影响产品或工程决策。

指标模板：

| 指标 | 定义 | 数据来源 | 目标值 | 告警阈值 |
|------|------|----------|--------|----------|
| ... | ... | ... | ... | ... |

对增长类需求可使用 AARRR；对体验类需求可使用 HEART；对平台能力可补充延迟、错误率、成功率、可用性和回滚率。

## 风险与假设验证

需求评审必须覆盖四类假设：

| 假设 | 核心问题 |
|------|----------|
| 价值 | 用户是否真的需要，是否创造业务价值？ |
| 可用性 | 用户是否能理解并完成流程？ |
| 商业可行性 | 运营、销售、财务、法务是否支持？ |
| 技术可行性 | 现有技术、数据、接口和时限能否支撑？ |

复杂需求应做预死亡分析：

- 发布阻断：上线前必须解决。
- 快速跟进：上线后短期内必须处理。
- 持续跟踪：记录并用指标监控。

风险不能只列问题，必须有缓解措施、负责人或门禁位置。

## Sprint 与交付计划

需求进入 Sprint 前必须满足就绪定义：

- 背景、目标、范围、验收标准和指标清楚。
- 依赖、权限、接口、数据口径和设计状态清楚。
- `Must` 与 `Not now` 明确。
- 风险和待确认项有处理路径。
- 相关测试或验收场景可设计。

Sprint 计划需要包含目标、容量、故事列表、依赖和风险。预留容量应覆盖评审修正、联调、测试和回滚准备。

## 发布说明

发布说明必须面向用户价值，而不是技术实现。

模板：

```markdown
# [产品或模块] - [版本 / 日期]

## 新功能
- **[功能名称]**：[用户能做什么，以及为什么重要]

## 改进
- **[改进方向]**：[什么变得更快、更清晰或更可靠]

## 修复
- 修复了 [用户语言描述的问题]

## 破坏性变更
- **需要操作**：[用户或管理员需要做什么]
```

技术表述要翻译成用户收益。例如“增加缓存层”应转成“仪表盘加载速度提升”。

## Agent 交付要求

产品类 agent 或实现前 agent 必须输出：

- 目标和非目标。
- 已知事实、假设、待确认项。
- 推荐方案与备选方案。
- MVP / Must / Should / Not now。
- 用户故事和验收标准。
- 指标、埋点或验证证据。
- 风险、依赖、人工门禁和下一步调度建议。

如果需求不完整，agent 应把缺口写入 `inbox` 或设计评审输出，而不是继续生成确定性实现计划。

## 验收清单

产品需求进入设计、实现或 PR 准备前至少确认：

- 需求不是只有功能描述，已经包含用户痛点、业务目标和成功指标。
- 范围明确，`Must`、`Should`、`Not now` 和 `Out of scope` 可区分。
- 用户故事和验收标准可测试。
- 权限、数据、异常、空态、失败态和逆向流程已覆盖。
- 优先级有依据，风险有缓解或门禁。
- 发布说明能用用户语言解释价值。

## English

## Goal

This standard distills PM Master-style product management skills into platform-level requirement rules for the Loop Engineering repository. It governs requirement intake, PRDs, detailed-design inputs, prioritization, metrics, risk, release notes, and implementation acceptance.

It is not a comprehensive product-methodology library, and agents must not mechanically apply every framework. The platform keeps only rules that directly support loop discovery, design gates, coding delivery, independent review, and memory capture.

## Scope

This standard applies to product requirements, frontend delivery loops, project-level `SKILL.md` files, design documents, requirement reviews, implementation acceptance, and release notes entering this engineering repository.

When requirements come from Yuque, local documents, conversation input, Issues, Jira, or memory, agents must normalize them into verifiable inputs before design or implementation. Missing product facts must not be replaced with implementation assumptions.

## Product Input Principles

1. Requirements must explain user pain and business goals, not only a feature solution.
2. Requirements must define target users, scenarios, scope boundaries, acceptance criteria, and success metrics.
3. Requirements must separate facts, assumptions, open questions, and deferred items.
4. Before coding, requirements must be verifiable through tests, review, or human gates.
5. Requirement documents should serve the delivery loop, not stack frameworks for display.

## Requirement Clarification

When a requirement enters a loop, answer these questions first:

| Question | Output |
|----------|--------|
| Who is the user? | Target role, permissions, usage frequency |
| What is the current pain? | Workaround, business impact, failure cost |
| Why now? | Goal, timing, constraints, external trigger |
| What counts as done? | Observable acceptance criteria and metrics |
| What is out of scope? | Out of scope, deferred items, explicit tradeoffs |
| What are the risks? | Business, UX, technical, data, security, and dependency risks |

If an answer affects API fields, permissions, page structure, core flow, or data definitions, mark it as open and preserve it in `inbox`, design review, or a human gate.

## Requirement Analysis Methods

Choose the smallest useful analysis framework:

- `5W1H`: quickly clarify role, scenario, motivation, scope, and implementation constraints.
- `JTBD`: move from a proposed solution back to real tasks, social needs, and emotional pressure.
- `Y model`: move from What to Why, then reconstruct How.
- `KANO`: classify must-have, performance, delight, and indifferent requirements.
- `Opportunity Solution Tree`: separate outcomes, opportunities, solutions, and experiments for complex discovery.

Do not apply every framework just to look complete. Every selected framework must produce a conclusion that affects scope, priority, design, or acceptance.

## False Requirement Detection

Treat these requirements carefully:

- The user specifies an implementation solution without explaining the underlying task or pain.
- The request reflects one user's preference without role or segment evidence.
- Business value, metric movement, or failure cost cannot be explained.
- The request only adds configurability, flexibility, or visual detail without changing behavior or outcomes.
- The request conflicts with permissions, data definitions, design gates, or project boundaries.

Handling steps:

1. Ask why and return to the task the user needs to complete.
2. Look for current behavior, data, interviews, tickets, or memory evidence.
3. Validate through a minimal experiment, MVP, rollout, or human confirmation.
4. If it cannot be validated, do not put it in Must scope.

## Minimum PRD Structure

Before design or implementation, a PRD must include at least:

```markdown
# [Requirement Name] PRD

## 1. Background And Goal
- User pain:
- Business goal:
- Success metric:

## 2. Target Users And Scenarios
- Role:
- Scenario:
- Current workaround:

## 3. Scope
- Must:
- Should:
- Not now:
- Out of scope:

## 4. User Story
- As a [role], I want [action], so that [value].

## 5. Core Flow
1. ...
2. ...
3. ...

## 6. Acceptance Criteria
1. Observable behavior:
2. Data validation:
3. Permissions and exceptions:
4. Empty, loading, and failure states:

## 7. Metrics And Events
- Business metric:
- Behavior event:
- Data source:

## 8. Risks And Open Questions
- Risk:
- Open question:
- Dependency:
```

A full PRD may add revision history, value proposition, detailed modules, non-functional requirements, event tracking, and risk matrices, but it must not omit the minimum structure.

## User Stories

User stories must satisfy INVEST:

- Independent: can be reviewed and delivered independently.
- Negotiable: allows design and engineering to improve the solution.
- Valuable: explains user or business benefit.
- Estimable: scope is clear enough.
- Small: fits a delivery slice.
- Testable: has explicit acceptance criteria.

Recommended format:

```text
As a [user role], I want [action or capability], so that [user or business value].
```

Acceptance criteria must describe observable behavior. Do not write unverifiable phrases such as "better experience", "as fast as possible", or "support it a bit".

## Detailed Design Inputs

When a PRD moves into detailed design, it must provide enough input so design and engineering do not guess:

- Core business objects, fields, permissions, states, and object relationships.
- Main flow, exception flow, reverse flow, and postconditions.
- Data sources, API authority, event tracking, and metric calculation definitions.
- Non-functional requirements: performance, security, compatibility, usability, and reliability.
- Design gates: which changes require product, design, engineering, or human approval.

If detailed design finds insufficient PRD input, return to requirement clarification instead of adding implementation assumptions.

## Prioritization

Choose prioritization frameworks by scenario:

| Scenario | Recommended framework |
|----------|-----------------------|
| Early exploration or limited evidence | ICE |
| Reach, impact, and effort data exist | RICE |
| Requirement classification and MVP boundary | KANO |
| Sprint scope management | MoSCoW |
| Fast solution tradeoff | Value / Effort matrix |

Priority decisions must state the evidence and confidence. `Must` is only for items required to form a closed loop or meet safety, permission, compliance, or core experience needs.

## Metrics

Each requirement must define at least one success metric and one guardrail metric.

Good metrics should be:

- Easy to understand: the team can share the same language.
- Comparable: across time, segments, or versions.
- Precisely defined: formula, data source, and measurement window are clear.
- Behavior-changing: metric movement affects product or engineering decisions.

Metric template:

| Metric | Definition | Data source | Target | Alert threshold |
|--------|------------|-------------|--------|-----------------|
| ... | ... | ... | ... | ... |

Growth requirements may use AARRR; experience requirements may use HEART; platform capabilities may add latency, error rate, success rate, availability, and rollback rate.

## Risk And Assumption Validation

Requirement review must cover four assumption types:

| Assumption | Key question |
|------------|--------------|
| Value | Do users need this, and does it create business value? |
| Usability | Can users understand and complete the flow? |
| Viability | Can operations, sales, finance, and legal support it? |
| Feasibility | Can current technology, data, APIs, and timeline support it? |

Complex requirements should use pre-mortem analysis:

- Release blocker: must be resolved before launch.
- Fast follow: must be handled shortly after launch.
- Monitor: record and watch through metrics.

Risks must include mitigation, owner, or gate location; listing problems alone is not enough.

## Sprint And Delivery Planning

Before entering a Sprint, a requirement must meet the definition of ready:

- Background, goal, scope, acceptance criteria, and metrics are clear.
- Dependencies, permissions, APIs, data definitions, and design state are clear.
- `Must` and `Not now` are explicit.
- Risks and open questions have handling paths.
- Relevant tests or acceptance scenarios can be designed.

Sprint plans need a goal, capacity, story list, dependencies, and risks. Reserve capacity for review fixes, integration, testing, and rollback preparation.

## Release Notes

Release notes must describe user value, not technical implementation.

Template:

```markdown
# [Product or Module] - [Version / Date]

## New
- **[Feature]**: [What users can do and why it matters]

## Improved
- **[Improvement]**: [What became faster, clearer, or more reliable]

## Fixed
- Fixed [the issue described in user language]

## Breaking Changes
- **Action required**: [What users or admins need to do]
```

Translate technical changes into user benefits. For example, "add cache layer" should become "dashboard loads faster."

## Agent Delivery Requirements

Product agents or pre-implementation agents must output:

- Goals and non-goals.
- Known facts, assumptions, and open questions.
- Recommended solution and alternatives.
- MVP / Must / Should / Not now.
- User stories and acceptance criteria.
- Metrics, events, or verification evidence.
- Risks, dependencies, human gates, and next agent routing.

If a requirement is incomplete, the agent should write the gap to `inbox` or design-review output instead of generating a deterministic implementation plan.

## Acceptance Checklist

Before a product requirement enters design, implementation, or PR readiness, confirm at least:

- The requirement is not only a feature description; it includes user pain, business goal, and success metric.
- Scope is clear, and `Must`, `Should`, `Not now`, and `Out of scope` are distinguishable.
- User stories and acceptance criteria are testable.
- Permissions, data, exceptions, empty states, failure states, and reverse flows are covered.
- Priority has evidence, and risks have mitigation or gates.
- Release notes can explain value in user language.
