import { appendFile, mkdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { LoopRuntime } from '../../loop-runtime/src/loopRuntime';
import {
  Finding,
  RuntimePlan,
  SimulationArtifact,
  SimulationResult,
  SimulationStage
} from '../../shared/src/types';
import { formatJson, writeText } from '../../shared/src/fs';
import { MemoryRootConfig, resolveMemoryPath, resolveMemoryRootConfig } from '../../shared/src/memoryRoot';
import { planCaseWrite, writeCase } from '../../memory-capture/src';
import { buildMemoryIndex, writeMemoryIndexAtomic } from '../../memory-indexer/src';
import { resolveMemoryProtocolPaths } from '../../memory-protocol/src';
import { countRunLogEntries } from '../../memory-store/src/memoryStore';

const execFileAsync = promisify(execFile);

export interface SimulationOptions {
  workspaceRoot: string;
  loopPath: string;
  repoRoot?: string;
  now?: Date;
}

export class SimulationRuntime {
  async simulate(options: SimulationOptions): Promise<SimulationResult> {
    const repoRoot = path.resolve(options.repoRoot ?? path.join(options.workspaceRoot, '..'));
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const now = options.now ?? new Date();
    const runId = buildRunId(now);
    const plan = await new LoopRuntime().dryRun({ workspaceRoot, loopPath: options.loopPath, now });
    const memoryConfig = await resolveMemoryRootConfig(workspaceRoot);
    const memoryRoot = memoryConfig.memoryRoot;
    const artifacts = artifactPaths(repoRoot, workspaceRoot, memoryRoot, plan.loopId, runId, now);
    const stages = buildStages(plan, artifacts);
    const sourceUser = await resolveSourceUser(repoRoot);

    await mkdir(path.dirname(artifacts.reportPath), { recursive: true });
    await mkdir(path.dirname(artifacts.casePath), { recursive: true });
    await mkdir(path.dirname(artifacts.casesIndexPath), { recursive: true });

    await writeText(artifacts.reportPath, renderReport(runId, now, plan, stages, artifacts));
    await writeText(artifacts.casePath, renderKnowledgeCase(now, artifacts, plan, sourceUser));
    const obsidianCase = await writeObsidianSimulationCase({
      workspaceRoot,
      memoryRoot,
      memoryConfig,
      now,
      plan,
      sourceUser
    });
    artifacts.obsidianCasePath = obsidianCase;
    await writeText(artifacts.casesIndexPath, formatJson([buildCaseIndexEntry(now, artifacts, sourceUser)]));
    await writeText(artifacts.patternsIndexPath, renderPatternsIndex(now, artifacts));
    await appendJsonl(resolveMemoryPath(memoryRoot, plan.persistence.runLog), {
      runId,
      mode: 'simulation',
      loopId: plan.loopId,
      status: 'completed',
      findings: plan.findings.length,
      report: relative(repoRoot, artifacts.reportPath),
      createdAt: now.toISOString()
    });
    const loopWorkCount = await countRunLogEntries(resolveMemoryPath(memoryRoot, plan.persistence.runLog));
    for (const finding of plan.findings) {
      await appendJsonl(resolveMemoryPath(memoryRoot, `memory/loops/${plan.loopId}/findings.jsonl`), {
        runId,
        ...finding
      });
    }
    await appendJsonl(resolveMemoryPath(memoryRoot, `memory/loops/${plan.loopId}/metrics.jsonl`), {
      runId,
      mode: 'simulation',
      stages: stages.length,
      findings: plan.findings.length,
      generatorRuns: plan.generatorRuns.length,
      evaluatorRuns: plan.evaluations.length,
      createdAt: now.toISOString()
    });
    await writeText(resolveMemoryPath(memoryRoot, plan.persistence.stateFile), renderState(now, plan));

    return {
      runId,
      loopId: plan.loopId,
      loopWorkCount,
      mode: 'simulation',
      stages,
      artifacts,
      summary: {
        findings: plan.findings.length,
        generatorRuns: plan.generatorRuns.length,
        evaluatorRuns: plan.evaluations.length,
        knowledgeCases: 1
      }
    };
  }
}

async function writeObsidianSimulationCase(input: {
  workspaceRoot: string;
  memoryRoot: string;
  memoryConfig: MemoryRootConfig;
  now: Date;
  plan: RuntimePlan;
  sourceUser: string;
}): Promise<string> {
  const protocol = resolveMemoryProtocolPaths({
    workspaceRoot: input.workspaceRoot,
    vaultRoot: input.memoryConfig.memoryVaultRoot ?? inferVaultRoot(input.memoryRoot),
    learningRootName: input.memoryConfig.memoryLearningRootName,
    projectId: inferProjectId(input.memoryRoot) ?? input.plan.handoff[0]?.project ?? 'default-project',
    loopId: input.plan.loopId
  });
  const casePlan = await planCaseWrite({
    casesRoot: protocol.casesRoot,
    title: 'Loop 系统真实落地前先跑端到端模拟',
    projectId: path.basename(protocol.projectRoot),
    loopId: input.plan.loopId,
    runId: buildRunId(input.now),
    date: input.now.toISOString().slice(0, 10),
    body: renderObsidianCaseBody(input.now, input.plan, input.sourceUser)
  });
  const written = await writeCase(casePlan);
  const index = await buildMemoryIndex({
    workspaceRoot: input.workspaceRoot,
    vaultRoot: protocol.vaultRoot,
    learningRootName: relativeLearningRoot(protocol)
  });
  await writeMemoryIndexAtomic(protocol.indexPath, index);
  return written.path;
}

function relativeLearningRoot(paths: ReturnType<typeof resolveMemoryProtocolPaths>): string {
  return path.relative(paths.vaultRoot, paths.learningRoot).replaceAll(path.sep, '/');
}

function renderObsidianCaseBody(now: Date, plan: RuntimePlan, sourceUser: string): string {
  return `## Trigger

需要验证 Loop Engineering 工程是否覆盖从初始化、代码仓接入、任务发现、隔离交付、独立评审到知识沉淀的完整链路。

## Symptom

只有 dry-run 计划时，无法确认 memory、report 和 team-growth case 是否能被稳定落盘。

## Rule

真实接入外部系统前，先提供确定性的本地 simulation，把每个阶段的输入、输出和沉淀产物写入可审计位置。

## Anti-Pattern

直接接入真实 LLM、真实 PR 和真实通知，再用线上副作用验证架构是否成立。

## Scope

适用于 Loop Engineering、agent workflow、自动化治理系统的本地验证。

## Evidence

- Loop: ${plan.loopId}
- Date: ${now.toISOString().slice(0, 10)}
- Source user: ${sourceUser}

## Reuse Hint

新增真实 connector、agent executor 或 evaluator 前，先更新 simulation，保证端到端产物仍然可审计。
`;
}

function buildRunId(now: Date): string {
  return `sim-${now.toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
}

function artifactPaths(
  repoRoot: string,
  workspaceRoot: string,
  memoryRoot: string,
  loopId: string,
  runId: string,
  now: Date
): SimulationArtifact {
  const date = now.toISOString().slice(0, 10);
  return {
    reportPath: path.join(workspaceRoot, 'reports', 'simulations', `${runId}.md`),
    statePath: path.join(memoryRoot, 'loops', loopId, 'state.md'),
    runLogPath: path.join(memoryRoot, 'loops', loopId, 'runs.jsonl'),
    findingsPath: path.join(memoryRoot, 'loops', loopId, 'findings.jsonl'),
    metricsPath: path.join(memoryRoot, 'loops', loopId, 'metrics.jsonl'),
    casePath: path.join(repoRoot, 'data', 'cases', `${date}-loop-simulation-lifecycle.md`),
    casesIndexPath: path.join(repoRoot, 'data', 'index', 'cases-index.json'),
    patternsIndexPath: path.join(repoRoot, 'data', 'index', 'patterns-index.md')
  };
}

function inferVaultRoot(memoryRoot: string): string {
  const marker = `${path.sep}88-学习${path.sep}`;
  const index = memoryRoot.indexOf(marker);
  return index >= 0 ? memoryRoot.slice(0, index) : memoryRoot;
}

function inferProjectId(memoryRoot: string): string | undefined {
  const parts = memoryRoot.split(path.sep);
  const markerIndex = parts.lastIndexOf('10-项目记忆');
  return markerIndex >= 0 ? parts[markerIndex + 1] : undefined;
}

function buildStages(plan: RuntimePlan, artifacts: SimulationArtifact): SimulationStage[] {
  const firstFinding = plan.findings[0];

  return [
    {
      id: 'init',
      title: '初始化 Loop 工作空间',
      status: 'completed',
      detail: `校验 loop spec、schema、agent、harness、connector、budget，并加载 ${plan.loopId}。`,
      outputs: [plan.context.skillPath, plan.context.stateFile]
    },
    {
      id: 'repo-intake',
      title: '接入代码仓与项目知识',
      status: 'completed',
      detail: `装配项目 ${plan.handoff[0]?.project ?? 'unknown'} 的 SKILL.md、triage skill、memory 和 connector evidence。`,
      outputs: [`evidence sources: ${plan.context.evidenceSources}`]
    },
    {
      id: 'discovery',
      title: '发现可处理事项',
      status: 'completed',
      detail: `从 connector evidence 中筛选出 ${plan.findings.length} 个 finding。`,
      outputs: plan.findings.map((finding) => `${finding.id}: ${finding.title}`)
    },
    {
      id: 'handoff',
      title: '隔离交付计划',
      status: 'completed',
      detail: `为每个 finding 生成独立 task、branch 和 worktree 路径。`,
      outputs: plan.handoff.map((worktree) => `${worktree.taskId}: ${worktree.branch}`)
    },
    {
      id: 'agent-review',
      title: '生成者与评审者模拟',
      status: 'completed',
      detail: `模拟 ${plan.generatorRuns.length} 个 generator run 和 ${plan.evaluations.length} 个 evaluator review。`,
      outputs: firstFinding ? [`sample: ${firstFinding.title} -> evaluator pending independent review`] : []
    },
    {
      id: 'knowledge',
      title: '知识沉淀',
      status: 'completed',
      detail: '将本轮经验沉淀为 team-growth case，并更新机器/人工索引。',
      outputs: [artifacts.casePath, artifacts.casesIndexPath, artifacts.patternsIndexPath]
    }
  ];
}

function renderReport(
  runId: string,
  now: Date,
  plan: RuntimePlan,
  stages: SimulationStage[],
  artifacts: SimulationArtifact
): string {
  return `# Loop Lifecycle Simulation Report

## Run

- Run ID: ${runId}
- Loop: ${plan.loopId}
- Created At: ${now.toISOString()}
- Mode: simulation

## Stages

${stages.map((stage) => `### ${stage.id}: ${stage.title}

- Status: ${stage.status}
- Detail: ${stage.detail}
- Outputs:
${stage.outputs.map((output) => `  - ${output}`).join('\n')}
`).join('\n')}

## Findings

${plan.findings.map(renderFinding).join('\n')}

## Handoff

${plan.handoff.map((item) => `- ${item.taskId}: ${item.branch} -> ${item.path}`).join('\n')}

## Verification

${plan.evaluations.map((item) => `- ${item.taskId}: ${item.evaluatorId}, checks=${item.requiredChecks.join(', ')}, selfReview=${item.allowSelfReview}`).join('\n')}

## Knowledge

- Case: ${artifacts.casePath}
- Cases index: ${artifacts.casesIndexPath}
- Patterns index: ${artifacts.patternsIndexPath}
`;
}

function renderFinding(finding: Finding): string {
  return `- ${finding.id}: ${finding.title}
  - Risk: ${finding.riskLevel}
  - Area: ${finding.suspectedArea}
  - Next: ${finding.suggestedNextAction}`;
}

function renderState(now: Date, plan: RuntimePlan): string {
  return `# Morning Triage State

## Current Focus

Main branch stability and repeated CI failures.

## Last Run

${now.toISOString()} (simulation)

## Open Findings

| ID | Title | Status | Owner |
|---|---|---|---|
${plan.findings.map((finding) => `| ${finding.id} | ${finding.title} | simulated_reviewed | loop |`).join('\n')}

## Carry Over

- Simulation completed from initialization through knowledge capture.
- Real execution still requires connector, worktree, agent, evaluator, and output side effects.
`;
}

function renderKnowledgeCase(
  now: Date,
  artifacts: SimulationArtifact,
  plan: RuntimePlan,
  sourceUser: string
): string {
  const date = now.toISOString().slice(0, 10);

  return `---
id: tg-case-${date}-loop-simulation-lifecycle
title: Loop 系统真实落地前先跑端到端模拟
status: draft
tags: [loop-engineering, simulation, workflow]
domains: [Both]
source_user_git: ${sourceUser}
source_date: ${date}
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

- \`${relative(process.cwd(), artifacts.reportPath)}\`
- \`${plan.context.skillPath}\`
- \`${plan.persistence.stateFile}\`

## Reuse Hint

新增真实 connector、agent executor 或 evaluator 前，先更新 simulation，保证端到端产物仍然可审计。
`;
}

function buildCaseIndexEntry(now: Date, artifacts: SimulationArtifact, sourceUser: string) {
  const date = now.toISOString().slice(0, 10);
  return {
    id: `tg-case-${date}-loop-simulation-lifecycle`,
    title: 'Loop 系统真实落地前先跑端到端模拟',
    tags: ['loop-engineering', 'simulation', 'workflow'],
    domains: ['Both'],
    source_user_git: sourceUser,
    status: 'draft',
    promote_score: 1,
    path: relative(process.cwd(), artifacts.casePath)
  };
}

function renderPatternsIndex(now: Date, artifacts: SimulationArtifact): string {
  return `# Patterns Index

## 主题目录

- 暂无 active pattern。当前只有 1 条 simulation case，未达到 3 条 case 的 pattern 归纳阈值。

## 最近更新

- ${now.toISOString().slice(0, 10)}: 新增 \`${relative(process.cwd(), artifacts.casePath)}\`
`;
}

async function appendJsonl(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await appendFile(filePath, JSON.stringify(value) + '\n', 'utf8');
}

async function resolveSourceUser(repoRoot: string): Promise<string> {
  if (process.env.TEAM_GROWTH_USER) {
    return process.env.TEAM_GROWTH_USER;
  }

  try {
    const result = await execFileAsync('git', ['config', 'user.name'], { cwd: repoRoot });
    const name = result.stdout.trim();
    return name || 'unknown';
  } catch {
    return 'unknown';
  }
}

function relative(from: string, to: string): string {
  return path.relative(from, to).replaceAll(path.sep, '/');
}
