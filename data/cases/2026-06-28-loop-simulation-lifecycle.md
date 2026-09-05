---
id: tg-case-2026-06-28-loop-simulation-lifecycle
title: Loop 系统真实落地前先跑端到端模拟
status: draft
tags: [loop-engineering, simulation, workflow]
domains: [Both]
source_user_git: zhusemin
source_date: 2026-06-28
source_topic: 模拟从初始化、代码仓到知识沉淀全过程
confidence: medium
promote_score: 1
related_patterns: []
related_skills: []
---

## Trigger

需要验证 Loop Engineering 工程是否覆盖从初始化、代码仓接入、任务发现、隔离交付、独立评审到知识沉淀的完整链路。

## Symptom

只有 dry-run 计划时，无法确认 memory、report 和 team-growth case 是否能被稳定落盘。

## Rule

真实接入外部系统前，先提供确定性的本地 simulation，把每个阶段的输入、输出和沉淀产物写入仓库可追踪位置。

## Anti-Pattern

直接接入真实 LLM、真实 PR 和真实通知，再用线上副作用验证架构是否成立。

## Scope

适用于 Loop Engineering、agent workflow、自动化治理系统的本地 MVP 验证。

## Evidence

- `workspace/reports/simulations/sim-20260628T051743.md`
- `projects/app-a/.loop/skills/triage.SKILL.md`
- `memory/loops/morning-triage/state.md`

## Reuse Hint

新增真实 connector、agent executor 或 evaluator 前，先更新 simulation，保证端到端产物仍然可审计。
