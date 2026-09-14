import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { findLoopSpec, readText } from '../packages/shared/src/fs';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const otherTmaxRepositories = [
  'max-console-ui',
  'max-operate-monitor-ui',
  'operateBusiness',
  'operateSupport',
  'dcm',
  'scan'
];

test('KPIUI explicit project route resolves to the standalone xigua executor', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetProject: 'KPIUI',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.equal(plan.execution.executor, 'xigua');
  assert.equal(plan.execution.source, 'mounted-background');
  assert.equal(plan.execution.agentId, 'xigua-frontend-agent');
  assert.equal(plan.execution.handoff?.executor, 'xigua');
  assert.equal(plan.execution.handoff?.entryPath, 'AGENT.md');
  assert.equal(plan.execution.handoff?.targetRepository, 'KPIUI');
  assert.equal(plan.orchestrator?.routesTo.project.projectId, 'KPIUI');
  assert.equal(plan.orchestrator?.routesTo.project.projectKind, 'Project');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-project');
  assert.equal(plan.orchestrator?.effective.source, 'skill-source');
  assert.equal(plan.orchestrator?.effective.agentId, 'xigua-frontend-agent');
  assert.equal(plan.orchestrator?.effective.entryPath, 'AGENT.md');
  assert.equal(plan.xigua?.skillContext.provider, 'xigua');
  assert.equal(plan.xigua?.skillContext.agentId, 'xigua-frontend-agent');
  assert.equal(plan.xigua?.skillContext.entryPath, 'AGENT.md');
  assert.match(plan.xigua?.skillContext.entryHash ?? '', /^[0-9a-f]{64}$/);
  assert.match(plan.xigua?.skillContext.sourceCommit ?? '', /^[0-9a-f]{40}$/);
  assert.equal(plan.xigua?.sourceConsumption.consumedBy, 'xigua-agent');
  assert.equal(plan.xigua?.taskContextLock.targetRepository, 'KPIUI');
});

test('KPIUI leading repository marker enters the standalone xigua route', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    userMessage: 'KPIUI 任意消息，路由判断不看正文',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'leading-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'KPIUI');
  assert.equal(plan.execution.executor, 'xigua');
  assert.equal(plan.execution.handoff?.targetRepository, 'KPIUI');
});

test('KPIUI project-context wording enters the standalone xigua route', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    userMessage:
      '在 KPIUI 项目里，新增一个“简易流水管理”页面，在 KPI 一级目录下，需求地址：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'leading-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'KPIUI');
  assert.equal(plan.execution.executor, 'xigua');
  assert.equal(plan.xigua?.requirementIntake.status, 'started');
  assert.deepEqual(plan.xigua?.requirementIntake.requirementSources, [
    'https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae'
  ]);
});

test('KPIUI scope excludes dcm and all other T-MAX repositories', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetProject: 'KPIUI',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.deepEqual(plan.xigua?.taskContextLock.projectScopeRepositories, ['KPIUI']);
  const routedRepositoryIds = plan.orchestrator?.routesTo.project.repositories.map((repository) => repository.id);
  assert.deepEqual(routedRepositoryIds, ['KPIUI']);
  for (const repositoryId of otherTmaxRepositories) {
    assert.equal(
      (plan.xigua?.taskContextLock.projectScopeRepositories ?? []).includes(repositoryId),
      false,
      repositoryId
    );
  }
});

test('xigua route skips the native Xiaobai page skill, worktree, generator, and evaluator', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetProject: 'KPIUI',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.deepEqual(plan.nativePageSkill, { status: 'skipped', reason: 'xigua-route' });
  assert.equal(plan.context.skillPath, 'skipped(xigua-route)');
  assert.equal(plan.handoff.length, 0);
  assert.equal(plan.generatorRuns.length, 0);
  assert.equal(plan.evaluations.length, 0);
  assert.equal(plan.workflow, undefined);
  assert.equal(plan.orchestrator?.routesTo.generatorAgent, undefined);
  assert.equal(plan.orchestrator?.routesTo.evaluatorAgent, undefined);
});

test('missing xigua source fails closed without a native fallback', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'xigua-source-missing-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const projectPath = path.join(tempWorkspace, 'projects', 'KPIUI', '.loop', 'project.yaml');
  const projectYaml = await readText(projectPath);
  await writeFile(
    projectPath,
    projectYaml.replace('background/xigua', 'background/missing-xigua'),
    'utf8'
  );

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot: tempWorkspace,
      loopPath,
      targetProject: 'KPIUI',
      now: new Date('2026-09-12T00:00:00.000Z')
    }),
    /Xigua source root is missing/
  );
});

test('HarmonyOS route keeps its own background with no xigua dispatch', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'harmonyWardrobe',
    now: new Date('2026-09-12T00:00:00.000Z')
  });

  assert.equal(plan.execution.executor, 'xiaobai');
  assert.equal(plan.xigua, undefined);
  assert.equal(plan.nativePageSkill, undefined);
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'harmony-wardrobe-context');
});

test('unknown target fails closed with no fallback executor', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');

  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      targetProject: 'not-a-known-project',
      now: new Date('2026-09-12T00:00:00.000Z')
    }),
    /Target project is not mapped to any project: not-a-known-project/
  );
});

test('route CLI emits the KPIUI xigua evidence and ordered trace events', async () => {
  const { stdout } = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'route',
    '--loop',
    'frontend-delivery',
    '--target-project',
    'KPIUI',
    '--json'
  ]);
  const result = JSON.parse(stdout) as {
    host: string;
    project: { id: string; kind: string; projectScopeRepositories: string[] };
    targetRepository: { id: string };
    background: { id: string; runtime: string; provider?: string };
    executor: string;
    xigua?: { entryPath: string; agentId: string };
    trace: { traceId: string; events: Array<{ event: string; detail?: string }> };
    write: string;
  };

  assert.equal(result.host, 'xiaobai');
  assert.equal(result.project.id, 'KPIUI');
  assert.equal(result.project.kind, 'Project');
  assert.deepEqual(result.project.projectScopeRepositories, ['KPIUI']);
  assert.equal(result.targetRepository.id, 'KPIUI');
  assert.equal(result.background.id, 'xigua');
  assert.equal(result.background.runtime, 'skill-source');
  assert.equal(result.background.provider, 'xigua');
  assert.equal(result.executor, 'xigua');
  assert.equal(result.xigua?.entryPath, 'AGENT.md');
  assert.equal(result.xigua?.agentId, 'xigua-frontend-agent');
  assert.equal(result.write, 'none');
  assert.match(result.trace.traceId, /^[\w-]{8,}$/);
  assert.deepEqual(
    result.trace.events.map((event) => event.event),
    [
      'xiaobai.entry.invoked',
      'project.route.resolved',
      'xigua.dispatch.started',
      'xigua.entry.read',
      'xigua.requirement.intake.started',
      'xigua.dispatch.completed',
      'xiaobai.native.page.skill',
      'target.write'
    ]
  );
  assert.match(
    result.trace.events.find((event) => event.event === 'xigua.dispatch.started')?.detail ?? '',
    /count=1/
  );
  assert.match(
    result.trace.events.find((event) => event.event === 'xigua.entry.read')?.detail ?? '',
    /entry=AGENT\.md/
  );
  assert.match(
    result.trace.events.find((event) => event.event === 'xiaobai.native.page.skill')?.detail ?? '',
    /skipped/
  );
});

test('route CLI reads the requirement URL read-only from the raw request text', async () => {
  const requestText =
    '在 KPIUI 项目里，新增一个“简易流水管理”页面，在 KPI 一级目录下，需求地址：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae';
  const { stdout } = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'route',
    '--loop',
    'frontend-delivery',
    '--target-project',
    'KPIUI',
    '--request-text',
    requestText,
    '--json'
  ]);
  const result = JSON.parse(stdout) as {
    executor: string;
    xigua?: { requirementIntake: { status: string; requirementSources: string[] } };
  };

  assert.equal(result.executor, 'xigua');
  assert.equal(result.xigua?.requirementIntake.status, 'started');
  assert.deepEqual(result.xigua?.requirementIntake.requirementSources, [
    'https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae'
  ]);
});
