# Frontend Master Design Skill / 前端主设计技能

## 中文

## 目标

为多仓或单仓前端需求生成一份主设计文档。主设计文档只落在主目标仓，工程仓只记录引用路径和门禁结果。

## 主设计文档结构

```markdown
# Frontend Master Technical Design

## 需求摘要 / Requirement Summary
## 目标仓与职责 / Target Repositories And Responsibilities
## 页面布局 / Page Layout
## 全局组件策略 / Shared Component Strategy
## 交互流程 / Interaction Flow
## 跨仓协作 / Cross-Repository Coordination
## 无障碍设计 / Accessibility
## 高效扫查设计 / Efficient Scanning
## 验收策略 / Acceptance Strategy
## 风险与待确认项 / Risks And Open Questions
```

## 落点规则

1. 优先使用主目标仓已有文档目录。
2. 若没有文档目录，创建 `docs/frontend-design/<requirement-id>.md`。
3. 文档必须记录需求来源、语雀链接或本地文档路径、源更新时间、目标仓、目标分支和设计门禁状态。
4. 不要把主设计正文写入工程仓。

## English

## Purpose

Generate one master design document for a single-repository or multi-repository frontend requirement. The master design belongs in the primary target repository; the engineering repository records only references and gate results.

## Master Design Document Structure

```markdown
# Frontend Master Technical Design

## 需求摘要 / Requirement Summary
## 目标仓与职责 / Target Repositories And Responsibilities
## 页面布局 / Page Layout
## 全局组件策略 / Shared Component Strategy
## 交互流程 / Interaction Flow
## 跨仓协作 / Cross-Repository Coordination
## 无障碍设计 / Accessibility
## 高效扫查设计 / Efficient Scanning
## 验收策略 / Acceptance Strategy
## 风险与待确认项 / Risks And Open Questions
```

## Placement Rules

1. Prefer an existing documentation directory in the primary target repository.
2. If no documentation directory exists, create `docs/frontend-design/<requirement-id>.md`.
3. The document must record the requirement source, Yuque link or local document path, source update time, target repository, target branch, and design gate status.
4. Do not write the master design body into the engineering repository.
