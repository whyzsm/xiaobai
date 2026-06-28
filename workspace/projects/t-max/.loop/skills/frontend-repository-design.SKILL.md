# Frontend Repository Design Skill / 前端仓内补充设计技能

## 中文

## 目标

为每个参与开发的目标仓生成仓内补充分设计文档。该文档只描述本仓职责，不替代主设计文档。

## 补充设计结构

```markdown
# Repository Frontend Design Supplement

## 仓库职责 / Repository Scope
## 页面与路由 / Pages And Routes
## 组件清单 / Component Inventory
## 数据与接口 / Data And APIs
## 状态设计 / UI States
## 实现切分 / Implementation Plan
## 仓内测试策略 / Repository Testing Strategy
## 与主设计的对应关系 / Alignment With Master Design
```

## 规则

1. 每个参与开发的目标仓都必须有自己的补充设计文档。
2. 补充设计文档必须落在对应目标仓内，不得落入工程仓。
3. 多仓协作时，跨仓依赖写入“与主设计的对应关系”小节。
4. 若某个仓设计未通过，该仓不得进入编码；除非需求要求整体同步交付，否则已通过的仓可以继续等待用户确认。

## English

## Purpose

Generate a repository-specific design supplement for every participating target repository. The supplement describes only that repository's responsibility and does not replace the master design document.

## Supplement Structure

```markdown
# Repository Frontend Design Supplement

## 仓库职责 / Repository Scope
## 页面与路由 / Pages And Routes
## 组件清单 / Component Inventory
## 数据与接口 / Data And APIs
## 状态设计 / UI States
## 实现切分 / Implementation Plan
## 仓内测试策略 / Repository Testing Strategy
## 与主设计的对应关系 / Alignment With Master Design
```

## Rules

1. Every participating target repository must have its own design supplement.
2. Repository supplements must be written inside the corresponding target repository, never in the engineering repository.
3. For multi-repository work, cross-repository dependencies go under the alignment section.
4. If one repository design fails review, that repository must not enter implementation. Repositories that passed may proceed to wait for user approval unless the requirement requires all repositories to ship together.
