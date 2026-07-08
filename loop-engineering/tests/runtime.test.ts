import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, pathExists, readText, readYamlFile } from '../packages/shared/src/fs';
import { ConnectorSpec } from '../packages/shared/src/types';
import { validateWorkspace } from '../packages/shared/src/validation';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const execFileAsync = promisify(execFile);

test('workspace validates against schemas and referenced files', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const result = await validateWorkspace(workspaceRoot, loopPath);

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('validate command checks all loops when no loop id is provided', async () => {
  const { stdout } = await execFileAsync('node', ['dist/loop-engineering/cli/loop.js', 'validate']);

  assert.match(stdout, /OK: workspace\/loops\/frontend-delivery.loop.yaml/);
  assert.match(stdout, /OK: workspace\/loops\/morning-triage.loop.yaml/);
});

test('dry run creates independent handoff and evaluation plans', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const runtime = new LoopRuntime();
  const plan = await runtime.dryRun({
    workspaceRoot,
    loopPath,
    now: new Date('2026-06-27T00:00:00.000Z')
  });

  assert.equal(plan.loopId, 'morning-triage');
  assert.equal(plan.budget.ok, true);
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.agentFile, 'xiaobai.orchestrator.agent.yaml');
  assert.equal(plan.orchestrator?.role, 'orchestrator');
  assert.equal(plan.orchestrator?.routesTo.project.projectId, 'app-a');
  assert.deepEqual(plan.orchestrator?.routesTo.workflowStages, []);
  assert.equal(plan.findings.length, 3);
  assert.equal(plan.handoff.length, plan.findings.length);
  assert.equal(plan.generatorRuns.length, plan.findings.length);
  assert.equal(plan.evaluations.length, plan.findings.length);
  assert.equal(plan.evaluations.every((evaluation) => evaluation.allowSelfReview === false), true);
  assert.equal(plan.handoff[0].branch, 'loop/morning-triage/2026-06-27/task-001');
  assert.deepEqual(plan.humanGate.protectedActions, ['merge']);
  assert(plan.memoryContext);
  assert.match(plan.memoryContext.indexPath, /memory-index\.json$/);
  assert(Array.isArray(plan.memoryContext.included));
  assert(Array.isArray(plan.memoryContext.omitted));
});

test('frontend delivery loop gates design approval before implementation', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const validation = await validateWorkspace(workspaceRoot, loopPath);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'operateBusiness',
    now: new Date('2026-06-28T00:00:00.000Z')
  });

  assert.equal(plan.loopId, 'frontend-delivery');
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.routesTo.discoverySkill, 'frontend-delivery');
  assert.equal(plan.orchestrator?.routesTo.generatorAgent, 'frontend-generator.agent.yaml');
  assert.equal(plan.orchestrator?.routesTo.evaluatorAgent, 'frontend-evaluator.agent.yaml');
  assert.equal(plan.orchestrator?.routesTo.project.projectId, 't-max');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'operateBusiness');
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'shared-skills');
  assert.equal(
    plan.orchestrator?.routesTo.project.repositories.some((repository) => repository.id === 'operateBusiness'),
    true
  );
  assert.match(
    plan.orchestrator?.routesTo.project.repositories.find((repository) => repository.id === 'operateBusiness')?.mount ?? '',
    /repos\/operateBusiness$/
  );
  assert.equal(plan.context.evidenceSources, 2);
  assert.equal(plan.findings.length, 2);
  assert.equal(plan.evaluations.every((evaluation) => evaluation.allowSelfReview === false), true);
  assert.deepEqual(plan.humanGate.protectedActions, [
    'human-design-approval',
    'coding',
    'merge',
    'release',
    'external-api-contract-change',
    'major-dependency-upgrade',
    'destructive-file-change'
  ]);
  assert.equal(
    plan.evaluations.every((evaluation) =>
      evaluation.requiredChecks.includes('human-design-approval') &&
      evaluation.requiredChecks.includes('frontend-design-review-passed') &&
      evaluation.requiredChecks.includes('pr-ready')
    ),
    true
  );
  assert.equal(
    plan.generatorRuns.every((run) =>
      run.expectedOutput.includes('masterDesignPath') &&
      run.expectedOutput.includes('repositoryDesignPaths') &&
      run.expectedOutput.includes('humanDesignApproval') &&
      run.expectedOutput.includes('pullRequestPlan')
    ),
    true
  );
});

test('frontend delivery exposes explicit workflow stages and yuque api shape', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'operateBusiness',
    now: new Date('2026-06-28T00:00:00.000Z')
  });

  assert.deepEqual(
    plan.workflow?.stages.map((stage) => stage.id),
    [
      'requirement-intake',
      'target-repository-resolution',
      'frontend-master-design',
      'frontend-repository-design',
      'frontend-design-review',
      'human-design-approval',
      'frontend-implementation',
      'implementation-verification',
      'pr-readiness'
    ]
  );
  assert.equal(plan.workflow?.stages.every((stage) => stage.status === 'planned'), true);
  assert.equal(
    plan.workflow?.stages.find((stage) => stage.id === 'human-design-approval')?.gate,
    'manual'
  );
  assert.equal(
    plan.workflow?.stages.find((stage) => stage.id === 'frontend-design-review')?.evaluator,
    'frontend-evaluator.agent.yaml'
  );
  assert.deepEqual(
    plan.workflow?.stages.find((stage) => stage.id === 'pr-readiness')?.outputs,
    ['pullRequestPlan', 'riskAndRollback']
  );

  const yuque = await readYamlFile<ConnectorSpec>(path.join(workspaceRoot, 'connectors', 'yuque.yaml'));
  assert.equal(yuque.config?.baseUrl, 'https://www.yuque.com/api/v2');
  assert.equal(yuque.auth?.type, 'env');
  assert.equal(yuque.auth?.tokenEnv, 'YUQUE_TOKEN');
  assert.equal(JSON.stringify(yuque).includes('tokenValue'), false);
});

test('frontend delivery requires a target before routing project background', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');

  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      now: new Date('2026-06-28T00:00:00.000Z')
    }),
    /requires a target project or repository/
  );
});

test('frontend delivery routes harmony repository to harmony background', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'harmonyWardrobe',
    now: new Date('2026-06-28T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.routesTo.project.projectId, 'harmony-wardrobe');
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'harmony-wardrobe-context');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'harmonyWardrobe');
  assert.equal(plan.handoff.every((handoff) => handoff.project === 'harmony-wardrobe'), true);
  assert.equal(plan.context.skillPath, 'projects/harmony-wardrobe/SKILL.md');
});

test('frontend delivery routes target remote to harmony background', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRemote: 'git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git',
    now: new Date('2026-06-28T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.routesTo.project.projectId, 'harmony-wardrobe');
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'harmony-wardrobe-context');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'remote');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'harmonyWardrobe');
});

test('unknown frontend target does not fall back to t-max', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');

  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      targetRepository: 'not-a-known-repository',
      now: new Date('2026-06-28T00:00:00.000Z')
    }),
    /Target repository is not mapped to any project: not-a-known-repository/
  );
});

test('workflow stage references are validated', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-workflow-validation-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  const loopYaml = await readText(loopPath);
  await writeFile(
    loopPath,
    loopYaml.replaceAll('agent: frontend-generator.agent.yaml', 'agent: missing-stage-agent.agent.yaml'),
    'utf8'
  );

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /Missing workflow stage agent: .*missing-stage-agent\.agent\.yaml/);
});

test('workflow stage ids must be unique', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-workflow-duplicate-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  const loopYaml = await readText(loopPath);
  await writeFile(loopPath, loopYaml.replace('id: target-repository-resolution', 'id: requirement-intake'), 'utf8');

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /Duplicate workflow stage id: requirement-intake/);
});

test('dry-run text output prints workflow stages', async () => {
  const { stdout } = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'dry-run',
    '--loop',
    'frontend-delivery',
    '--target-repository',
    'operateBusiness'
  ]);

  assert.match(stdout, /Workflow stages: 9/);
  assert.match(stdout, /Orchestrator: xiaobai \(xiaobai\.orchestrator\.agent\.yaml\)/);
  assert.match(stdout, /Resolved target: operateBusiness -> t-max -> shared-skills/);
  assert.match(stdout, /Route source: explicit-repository/);
  assert.match(stdout, /Project route: t-max -> shared-skills, repositories: 7/);
  assert.match(stdout, /requirement-intake \[intake, automatic, planned\]/);
  assert.match(stdout, /human-design-approval \[human-gate, manual, planned\]/);
});

test('dry-run output shows loop work count from run log', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-work-count-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');
  const runLog = path.join(tempWorkspace, 'memory', 'loops', 'morning-triage', 'runs.jsonl');
  await mkdir(path.dirname(runLog), { recursive: true });
  await writeFile(runLog, '{"runId":"prev-1"}\n{"runId":"prev-2"}\n', 'utf8');

  const text = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'dry-run',
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage'
  ]);
  assert.match(text.stdout, /Loop work count: 2/);

  const json = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'dry-run',
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage',
    '--json'
  ]);
  const plan = JSON.parse(json.stdout) as { loopWorkCount?: number };
  assert.equal(plan.loopWorkCount, 2);
});

test('dry-run text output shows harmony route when target repository is harmonyWardrobe', async () => {
  const { stdout } = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'dry-run',
    '--loop',
    'frontend-delivery',
    '--target-repository',
    'harmonyWardrobe'
  ]);

  assert.match(stdout, /Resolved target: harmonyWardrobe -> harmony-wardrobe -> harmony-wardrobe-context/);
  assert.match(stdout, /Route source: explicit-repository/);
  assert.match(stdout, /Project route: harmony-wardrobe -> harmony-wardrobe-context, repositories: 1/);
  assert.match(stdout, /Context: 2 evidence sources, projects\/harmony-wardrobe\/SKILL\.md/);
});

test('orchestrator agent must be present and use orchestrator role', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-orchestrator-validation-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const orchestratorPath = path.join(tempWorkspace, 'agents', 'xiaobai.orchestrator.agent.yaml');
  const orchestratorYaml = await readText(orchestratorPath);
  await writeFile(orchestratorPath, orchestratorYaml.replace('role: orchestrator', 'role: maker'), 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /Orchestrator agent must use role: orchestrator/);
});

test('frontend delivery skills document dynamic repositories and design gates', async () => {
  const skill = await readText(
    path.join(workspaceRoot, 'projects', 't-max', '.loop', 'skills', 'frontend-delivery.SKILL.md')
  );
  assert.match(skill, /语雀/);
  assert.match(skill, /Yuque/);
  assert.match(skill, /动态挂载/);
  assert.match(skill, /dynamic mounted/);
  assert.match(skill, /主设计文档/);
  assert.match(skill, /master design document/);
  assert.match(skill, /human-design-approval/);
  assert.match(skill, /不得进入编码/);
  assert.match(skill, /must not enter implementation/);
});

test('harmony wardrobe project background is mounted as a standalone repository', async () => {
  const projectRoot = path.join(workspaceRoot, 'projects', 'harmony-wardrobe');
  const project = await readYamlFile<{
    kind: string;
    id: string;
    background: { id: string; localPathKey: string; mount: string };
    repositories: Array<{ id: string; localPathKey: string; mount: string; remote: string }>;
  }>(path.join(projectRoot, '.loop', 'project.yaml'));

  assert.equal(project.kind, 'ProjectGroup');
  assert.equal(project.id, 'harmony-wardrobe');
  assert.equal(project.background.localPathKey, 'harmonyWardrobe');
  assert.equal(project.repositories.length, 1);
  assert.equal(project.repositories[0].id, 'harmonyWardrobe');
  assert.equal(project.repositories[0].localPathKey, project.background.localPathKey);
  assert.equal(
    project.repositories[0].remote,
    'git@codeup.aliyun.com:62ecbcd881ddd27ad912a7b9/harmonyWardrobe.git'
  );
  assert.match(project.background.mount, /mounts\/background\/harmonyWardrobe$/);
  assert.match(project.repositories[0].mount, /mounts\/repos\/harmonyWardrobe$/);

  const packageJson = await readYamlFile<{ scripts: Record<string, string> }>(path.join(repoRoot, 'package.json'));
  assert.equal(packageJson.scripts['mount:harmony-wardrobe'], 'node workspace/projects/harmony-wardrobe/scripts/mount-local.mjs');

  const skill = await readText(path.join(projectRoot, 'SKILL.md'));
  assert.match(skill, /鸿蒙原生开发/);
  assert.match(skill, /harmonyWardrobe/);
  assert.match(skill, /mount:harmony-wardrobe/);

  const readme = await readText(path.join(projectRoot, 'README.md'));
  assert.match(readme, /个人衣橱柜管理 app/);
  assert.match(readme, /workspace\/\.local\/harmony-wardrobe\/mounts\/repos\/harmonyWardrobe/);
});

test('simulation writes report, memory, and knowledge artifacts', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-sim-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');
  const runLog = path.join(tempWorkspace, 'memory', 'loops', 'morning-triage', 'runs.jsonl');
  await mkdir(path.dirname(runLog), { recursive: true });
  await writeFile(runLog, '{"runId":"prev-1"}\n{"runId":"prev-2"}\n', 'utf8');
  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const runtime = new SimulationRuntime();
  const result = await runtime.simulate({
    workspaceRoot: tempWorkspace,
    repoRoot: tempRoot,
    loopPath,
    now: new Date('2026-06-28T01:02:03.000Z')
  });

  assert.equal(result.mode, 'simulation');
  assert.equal(result.stages.length, 6);
  assert.equal(result.summary.findings, 3);
  assert.equal((result as { loopWorkCount?: number }).loopWorkCount, 3);
  assert.equal(await pathExists(result.artifacts.reportPath), true);
  assert.equal(await pathExists(result.artifacts.casePath), true);
  assert.equal(await pathExists(result.artifacts.obsidianCasePath ?? ''), true);
  assert.equal(await pathExists(result.artifacts.casesIndexPath), true);
  assert.equal(
    await pathExists(path.join(tempWorkspace, 'memory', '88-学习', '00-记忆索引', 'memory-index.json')),
    true
  );

  const report = await readText(result.artifacts.reportPath);
  assert.match(report, /初始化 Loop 工作空间/);
  assert.match(report, /知识沉淀/);

  const state = await readText(result.artifacts.statePath);
  assert.match(state, /simulation/);
  assert.match(state, /Auth tests failing on main/);

  const caseBody = await readText(result.artifacts.casePath);
  assert.match(caseBody, /## Rule/);
  assert.match(caseBody, /端到端模拟/);

  const obsidianCase = await readText(result.artifacts.obsidianCasePath ?? '');
  assert.match(obsidianCase, /type: case/);
  assert.match(obsidianCase, /端到端模拟/);
});

test('memory root can be redirected outside the workspace', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-memory-root-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  const externalMemoryRoot = path.join(tempRoot, 'obsidian-vault', '88-学习', 'Loop Engineering Memory');
  const externalLoopMemory = path.join(externalMemoryRoot, 'loops', 'morning-triage');

  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await mkdir(externalLoopMemory, { recursive: true });
  await writeFile(
    path.join(externalLoopMemory, 'state.md'),
    '# External State\n\nManaged from Obsidian.\n',
    'utf8'
  );
  await writeFile(path.join(externalLoopMemory, 'inbox.md'), '# External Inbox\n', 'utf8');
  await writeFile(path.join(externalLoopMemory, 'runs.jsonl'), '', 'utf8');
  await writeFile(
    path.join(tempWorkspace, 'workspace.local.yaml'),
    `memoryRoot: ${externalMemoryRoot}\n`,
    'utf8'
  );

  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const plan = await new LoopRuntime().dryRun({
    workspaceRoot: tempWorkspace,
    loopPath,
    now: new Date('2026-06-28T01:02:03.000Z')
  });

  assert.equal(plan.context.stateFile, path.join(externalLoopMemory, 'state.md'));
  assert.equal(plan.persistence.runLog, path.join(externalLoopMemory, 'runs.jsonl'));
});

test('dry-run memory context follows nested Obsidian learning root', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-memory-nested-root-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  const vaultRoot = path.join(tempRoot, 'obsidian-vault');
  const externalMemoryRoot = path.join(vaultRoot, '88-学习', 'xiaobai', '10-项目记忆', 'xbaiProjectCode');
  const externalLoopMemory = path.join(externalMemoryRoot, 'loops', 'morning-triage');

  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await mkdir(externalLoopMemory, { recursive: true });
  await writeFile(path.join(externalLoopMemory, 'state.md'), '# Nested State\n', 'utf8');
  await writeFile(path.join(externalLoopMemory, 'inbox.md'), '# Nested Inbox\n', 'utf8');
  await writeFile(path.join(externalLoopMemory, 'runs.jsonl'), '', 'utf8');
  await writeFile(
    path.join(externalMemoryRoot, 'index.md'),
    '# xbaiProjectCode 项目记忆\n\nNested learning root.\n',
    'utf8'
  );
  await writeFile(
    path.join(tempWorkspace, 'workspace.local.yaml'),
    `memoryRoot: ${externalMemoryRoot}\n`,
    'utf8'
  );

  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot: tempWorkspace,
    loopPath,
    now: new Date('2026-06-28T01:02:03.000Z')
  });

  assert.equal(
    plan.memoryContext?.indexPath,
    path.join(vaultRoot, '88-学习', 'xiaobai', '00-记忆索引', 'memory-index.json')
  );
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', 'xiaobai', '00-记忆索引', 'memory-index.json')), true);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', '00-记忆索引', 'memory-index.json')), false);
});
