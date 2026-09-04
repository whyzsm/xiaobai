import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { HarnessRuntime } from '../packages/harness-runtime/src/harnessRuntime';
import { GatePassStore, HumanGate } from '../packages/human-gate/src/humanGate';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, pathExists, readText, readYamlFile } from '../packages/shared/src/fs';
import { ConnectorSpec, HarnessRunSubmission, LoopSpec } from '../packages/shared/src/types';
import { validateWorkspace } from '../packages/shared/src/validation';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const execFileAsync = promisify(execFile);
const subjectDigest = `sha256:${'a'.repeat(64)}`;
const changedSubjectDigest = `sha256:${'b'.repeat(64)}`;
const tmaxRepositories = [
  'KPIUI',
  'max-console-ui',
  'max-operate-monitor-ui',
  'operateBusiness',
  'operateSupport',
  'dcm',
  'scan'
];

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
  assert.deepEqual(plan.orchestrator?.routesTo.workflowStages, [
    'triage-discovery',
    'finding-isolation',
    'finding-implementation',
    'finding-verification',
    'pr-readiness',
    'merge-approval'
  ]);
  assert.equal(plan.findings.length, 3);
  assert.equal(plan.handoff.length, plan.findings.length);
  assert.equal(plan.generatorRuns.length, plan.findings.length);
  assert.equal(plan.evaluations.length, plan.findings.length);
  assert.equal(plan.evaluations.every((evaluation) => evaluation.allowSelfReview === false), true);
  assert.equal(plan.handoff[0].branch, 'loop/morning-triage/2026-06-27/task-001');
  assert.deepEqual(plan.humanGate.protectedActions, ['merge']);
  assert.deepEqual(
    plan.workflow?.stages.find((stage) => stage.id === 'finding-verification')?.dependsOn,
    ['finding-implementation']
  );
  assert.equal(plan.workflow?.stages.find((stage) => stage.id === 'merge-approval')?.gate, 'manual');
  assert(plan.memoryContext);
  assert.match(plan.memoryContext.indexPath, /memory-index\.json$/);
  assert(Array.isArray(plan.memoryContext.included));
  assert(Array.isArray(plan.memoryContext.omitted));
});

test('harness accepts a fully evidenced run submission', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const runtime = new HarnessRuntime(workspaceRoot);
  const harness = await runtime.load(loop);
  const submission: HarnessRunSubmission = {
    runId: 'run-001',
    taskId: 'task-001',
    agentId: 'generator',
    harnessId: 'coding-harness',
    startedAt: '2026-08-10T00:00:00.000Z',
    finishedAt: '2026-08-10T00:00:02.000Z',
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 8000,
    toolsUsed: ['read_file', 'search_code', 'git_diff'],
    completedConditions: ['code_changed', 'tests_attempted', 'summary_written'],
    output: {
      summary: 'Changed the target file.',
      changedFiles: ['src/example.ts'],
      testResult: 'passed',
      nextRecommendation: 'review'
    },
    evidence: [
      { checkId: 'code_changed', type: 'diff', value: 'git diff -- src/example.ts' },
      { checkId: 'tests_attempted', type: 'test', value: 'target test passed' },
      { checkId: 'summary_written', type: 'file', value: 'run output summary' }
    ]
  };

  const result = runtime.evaluateRun(loop, harness, submission);
  assert.equal(result.status, 'passed');
  assert.equal(result.durationMs, 2000);
  assert.deepEqual(result.violations.missingConditions, []);
  assert.deepEqual(result.violations.missingOutputs, []);
});

test('harness fails closed on identity, context, tool, completion, output, and evidence violations', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const runtime = new HarnessRuntime(workspaceRoot);
  const harness = await runtime.load(loop);

  const result = runtime.evaluateRun(loop, harness, {
    runId: 'run-002',
    taskId: 'task-002',
    agentId: 'evaluator',
    harnessId: 'unknown-harness',
    startedAt: '2026-08-10T00:00:02.000Z',
    finishedAt: '2026-08-10T00:00:01.000Z',
    loadedContext: ['repository-skill'],
    contextCharactersUsed: 13000,
    toolsUsed: ['delete_repository', 'screenshot'],
    completedConditions: ['code_changed', 'unknown-condition'],
    output: { summary: 'Incomplete result' },
    evidence: []
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.checks.identity, false);
  assert.equal(result.checks.context, false);
  assert.equal(result.checks.tools, false);
  assert.equal(result.checks.completion, false);
  assert.equal(result.checks.output, false);
  assert.equal(result.checks.evidence, false);
  assert.match(result.violations.submissionErrors.join('\n'), /finishedAt/);
  assert.deepEqual(result.violations.deniedTools, ['delete_repository']);
  assert.deepEqual(result.violations.unallowedTools, ['delete_repository', 'screenshot']);
  assert.deepEqual(result.violations.missingConditions, ['tests_attempted', 'summary_written']);
  assert.deepEqual(result.violations.unknownConditions, ['unknown-condition']);
  assert.deepEqual(result.violations.missingOutputs, ['changedFiles', 'testResult', 'nextRecommendation']);
  assert.deepEqual(result.violations.missingEvidence, ['code_changed']);
});

test('gate pass authorizes the bound workflow stage with required evidence', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = new HumanGate(loop);
  const pass = gate.grant({
    gateId: 'human-design-approval',
    runId: 'run-gate-001',
    taskId: 'task-gate-001',
    stageId: 'frontend-implementation',
    issuer: 'wusheng',
    subjectDigest,
    evidence: [
      { type: 'review', value: 'design review report' },
      { type: 'human-approval', value: 'owner approved the design' }
    ],
    now: new Date('2026-08-10T00:00:00.000Z')
  });

  const decision = gate.check(
    {
      runId: 'run-gate-001',
      taskId: 'task-gate-001',
      stageId: 'frontend-implementation',
      subjectDigest,
      now: new Date('2026-08-10T00:01:00.000Z')
    },
    [pass]
  );

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.requiredGates, ['human-design-approval']);
  assert.deepEqual(decision.satisfiedGates, ['human-design-approval']);
  assert.equal(decision.passes[0]?.passId, pass.passId);
});

test('gate pass grant rejects unauthorized reviewers, missing evidence, and unrelated stages', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = new HumanGate(loop);
  const baseInput = {
    gateId: 'human-design-approval',
    runId: 'run-gate-002',
    taskId: 'task-gate-002',
    stageId: 'frontend-implementation',
    issuer: 'wusheng',
    subjectDigest,
    evidence: [
      { type: 'review' as const, value: 'design review report' },
      { type: 'human-approval' as const, value: 'owner approved the design' }
    ]
  };

  assert.throws(() => gate.grant({ ...baseInput, issuer: 'not-the-owner' }), /is not authorized/);
  assert.throws(
    () => gate.grant({ ...baseInput, evidence: [{ type: 'human-approval', value: 'owner approved' }] }),
    /requires evidence type: review/
  );
  assert.throws(() => gate.grant({ ...baseInput, stageId: 'implementation-verification' }), /is not required by/);
});

test('gate pass is invalidated by subject changes, expiration, and revocation', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = new HumanGate(loop);
  const issuedAt = new Date('2026-08-10T00:00:00.000Z');
  const pass = gate.grant({
    gateId: 'human-design-approval',
    runId: 'run-gate-003',
    taskId: 'task-gate-003',
    stageId: 'frontend-implementation',
    issuer: 'wusheng',
    subjectDigest,
    evidence: [
      { type: 'review', value: 'design review report' },
      { type: 'human-approval', value: 'owner approved the design' }
    ],
    now: issuedAt
  });

  const changed = gate.check(
    {
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      subjectDigest: changedSubjectDigest,
      now: new Date('2026-08-10T00:01:00.000Z')
    },
    [pass]
  );
  assert.equal(changed.status, 'blocked');
  assert.match(changed.blockingReasons.join('\n'), /subject digest changed/);

  const expired = gate.check(
    {
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      subjectDigest,
      now: new Date('2026-08-11T00:00:00.000Z')
    },
    [pass]
  );
  assert.equal(expired.status, 'blocked');
  assert.match(expired.blockingReasons.join('\n'), /is expired/);

  const revoked = gate.revoke(pass, 'wusheng', 'requirements changed', new Date('2026-08-10T00:02:00.000Z'));
  const revokedDecision = gate.check(
    {
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      subjectDigest,
      now: new Date('2026-08-10T00:03:00.000Z')
    },
    [pass, revoked]
  );
  assert.equal(revokedDecision.status, 'blocked');
  assert.match(revokedDecision.blockingReasons.join('\n'), /is revoked/);
});

test('gate pass store preserves an append-only grant and revoke history', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = new HumanGate(loop);
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-gate-store-'));
  const store = new GatePassStore(memoryRoot, loop.metadata.id);
  const pass = gate.grant({
    gateId: 'human-design-approval',
    runId: 'run-gate-004',
    taskId: 'task-gate-004',
    stageId: 'frontend-implementation',
    issuer: 'wusheng',
    subjectDigest,
    evidence: [
      { type: 'review', value: 'design review report' },
      { type: 'human-approval', value: 'owner approved the design' }
    ]
  });
  const revoked = gate.revoke(pass, 'wusheng', 'approval withdrawn');

  await store.append(pass);
  await store.append(revoked);

  assert.equal(store.filePath(), path.join(memoryRoot, 'loops', 'frontend-delivery', 'passes.jsonl'));
  assert.deepEqual((await store.readAll()).map((event) => event.status), ['granted', 'revoked']);
  assert.equal((await store.current(pass.passId))?.status, 'revoked');
  assert.equal((await readText(store.filePath())).trim().split('\n').length, 2);
});

test('gate CLI approves, checks, and revokes an append-only pass', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-gate-cli-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const commonArgs = [
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage',
    '--run-id',
    'run-cli-001',
    '--task-id',
    'task-cli-001',
    '--subject-digest',
    subjectDigest,
    '--json'
  ];
  const approved = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'gate',
    'approve',
    ...commonArgs,
    '--gate',
    'merge-approval',
    '--issuer',
    'wusheng',
    '--evidence',
    'test:unit tests passed',
    '--evidence',
    'review:independent review passed',
    '--evidence',
    'human-approval:owner approved merge'
  ]);
  const pass = JSON.parse(approved.stdout) as { passId: string; status: string };
  assert.equal(pass.status, 'granted');

  const checked = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'gate',
    'check',
    ...commonArgs,
    '--action',
    'merge'
  ]);
  assert.equal((JSON.parse(checked.stdout) as { status: string }).status, 'passed');

  const revoked = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'gate',
    'revoke',
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage',
    '--pass-id',
    pass.passId,
    '--issuer',
    'wusheng',
    '--reason',
    'approval withdrawn',
    '--json'
  ]);
  assert.equal((JSON.parse(revoked.stdout) as { status: string }).status, 'revoked');
  assert.equal(
    (await readText(path.join(tempWorkspace, 'memory', 'loops', 'morning-triage', 'passes.jsonl')))
      .trim()
      .split('\n').length,
    2
  );
});

test('T-MAX page delivery hands off after Xiaobai resolves the target', async () => {
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
  assert.equal(plan.orchestrator?.routesTo.generatorAgent, undefined);
  assert.equal(plan.orchestrator?.routesTo.evaluatorAgent, undefined);
  assert.equal(plan.orchestrator?.routesTo.project.projectId, 't-max');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'operateBusiness');
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'xiaoneng');
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.effective.agentId, 'xiaoneng-agent');
  assert.equal(plan.orchestrator?.effective.source, 'manifest-source');
  assert.equal(plan.orchestrator?.effective.entryPath, 'xiaoneng-agent/SKILL.md');
  assert.equal(plan.orchestrator?.effective.manifestPath, 'harness/runtime/manifest.yaml');
  assert.equal(plan.orchestrator?.effective.executionMode, 'PageImplementation');
  assert.equal(plan.orchestrator?.effective.ownerAgent, 'watermelon-frontend-agent');
  assert.deepEqual(plan.orchestrator?.effective.ownerSkills, ['fe-page-workflow', 'fe-typescript-safety']);
  assert.equal(plan.execution.executor, 'xiaoneng');
  assert.equal(plan.execution.agentId, 'xiaoneng-agent');
  assert.equal(plan.execution.source, 'mounted-background');
  assert.equal(plan.execution.handoff?.targetRepository, 'operateBusiness');
  assert.equal(plan.handoff.length, 0);
  assert.equal(plan.generatorRuns.length, 0);
  assert.equal(plan.evaluations.length, 0);
  assert.equal(plan.workflow, undefined);
  assert.equal(plan.orchestrator?.routesTo.generatorAgent, undefined);
  assert.equal(plan.orchestrator?.routesTo.evaluatorAgent, undefined);
  assert.equal(plan.xiaoneng?.skillContext.skillId, 'xiaoneng-agent');
  assert.equal(plan.xiaoneng?.taskContextLock.targetRepository, 'operateBusiness');
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
  assert.deepEqual(plan.humanGate.protectedActions, [
    'coding',
    'merge',
    'release',
    'external-api-contract-change',
    'major-dependency-upgrade',
    'destructive-file-change'
  ]);
  assert.equal(plan.humanGate.gates.length, 6);
});

test('all T-MAX repositories hand off directly to the mounted Xiaoneng executor', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');

  for (const repositoryId of tmaxRepositories) {
    const plan = await new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      targetRepository: repositoryId,
      now: new Date('2026-06-28T00:00:00.000Z')
    });

    assert.equal(plan.execution.executor, 'xiaoneng', repositoryId);
    assert.equal(plan.execution.agentId, 'xiaoneng-agent', repositoryId);
    assert.equal(plan.orchestrator?.effective.agentId, 'xiaoneng-agent', repositoryId);
    assert.equal(plan.orchestrator?.effective.source, 'manifest-source', repositoryId);
    assert.equal(plan.orchestrator?.effective.entryPath, 'xiaoneng-agent/SKILL.md', repositoryId);
    assert.equal(plan.orchestrator?.effective.manifestPath, 'harness/runtime/manifest.yaml', repositoryId);
    assert.equal(plan.execution.source, 'mounted-background', repositoryId);
    assert.equal(plan.execution.handoff?.targetRepository, repositoryId);
    assert.equal(plan.xiaoneng?.taskContextLock.targetRepository, repositoryId);
    assert.equal(plan.handoff.length, 0, repositoryId);
    assert.equal(plan.generatorRuns.length, 0, repositoryId);
    assert.equal(plan.evaluations.length, 0, repositoryId);
    assert.equal(plan.workflow, undefined, repositoryId);
  }
});

test('frontend delivery exposes explicit workflow stages and yuque api shape', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'harmonyWardrobe',
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
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.execution.executor, 'xiaobai');
  assert.equal(plan.execution.source, 'workspace-agent');
  assert.equal(plan.orchestrator?.effective.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.effective.source, 'loop-config');
  assert.equal(plan.xiaoneng, undefined);
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'harmonyWardrobe');
  assert.equal(plan.handoff.every((handoff) => handoff.project === 'harmony-wardrobe'), true);
  assert.equal(plan.context.skillPath, 'projects/harmony-wardrobe/SKILL.md');
});

test('frontend delivery routes trunkFeeder-ui repository to trunkFeeder background', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'trunkFeeder-ui',
    now: new Date('2026-06-28T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.routesTo.project.projectId, 'trunkFeeder');
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'trunkFeeder');
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.execution.executor, 'xiaobai');
  assert.equal(plan.execution.source, 'workspace-agent');
  assert.equal(plan.orchestrator?.effective.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.effective.source, 'loop-config');
  assert.equal(plan.xiaoneng, undefined);
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'trunkFeeder-ui');
  assert.equal(plan.handoff.every((handoff) => handoff.project === 'trunkFeeder'), true);
  assert.equal(plan.context.skillPath, 'projects/trunkFeeder/SKILL.md');
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
  assert.equal(plan.orchestrator?.agentId, 'xiaobai');
  assert.equal(plan.execution.executor, 'xiaobai');
  assert.equal(plan.execution.source, 'workspace-agent');
  assert.equal(plan.orchestrator?.effective.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.effective.source, 'loop-config');
  assert.equal(plan.xiaoneng, undefined);
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

test('invalid project background runtime type fails closed', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-project-runtime-validation-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const projectPath = path.join(tempWorkspace, 'projects', 't-max', '.loop', 'project.yaml');
  const projectYaml = await readText(projectPath);
  await writeFile(projectPath, projectYaml.replace('type: manifest-source', 'type: unknown-agent'), 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot: tempWorkspace,
      loopPath,
      targetRepository: 'operateBusiness',
      now: new Date('2026-06-28T00:00:00.000Z')
    }),
    /Invalid project background runtime type/
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

test('workflow dependencies must reference prior stages', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-workflow-dependency-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const loopYaml = await readText(loopPath);
  await writeFile(loopPath, loopYaml.replace('- triage-discovery', '- not-a-stage'), 'utf8');

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /depends on an unknown or non-prior stage: not-a-stage/);
});

test('all verification checks must be assigned to workflow stages', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-workflow-checks-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const loopYaml = await readText(loopPath);
  await writeFile(loopPath, loopYaml.replaceAll('        - unit-tests\n', ''), 'utf8');

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /Verification check is not assigned to any workflow stage: unit-tests/);
});

test('workflow required gates must reference defined human gates', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-workflow-gate-reference-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  const loopYaml = await readText(loopPath);
  await writeFile(
    loopPath,
    loopYaml.replace(
      'requiredGates:\n        - human-design-approval',
      'requiredGates:\n        - undefined-design-gate'
    ),
    'utf8'
  );

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(
    validation.errors.join('\n'),
    /Workflow stage frontend-implementation requires an undefined human gate: undefined-design-gate/
  );
});

test('human gate definitions cannot drift from protected actions or reuse ids', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-human-gate-validation-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');

  const loopPath = await findLoopSpec(tempWorkspace, 'frontend-delivery');
  const loopYaml = await readText(loopPath);
  await writeFile(
    loopPath,
    loopYaml
      .replace('id: merge-approval', 'id: human-design-approval')
      .replace('requiredBefore: release', 'requiredBefore: release-candidate'),
    'utf8'
  );

  const validation = await validateWorkspace(tempWorkspace, loopPath);
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join('\n'), /Duplicate human gate id: human-design-approval/);
  assert.match(validation.errors.join('\n'), /Human gate protected action is not defined by a gate: release/);
  assert.match(
    validation.errors.join('\n'),
    /Human gate definition action is not declared in requiredBefore: release-candidate/
  );
});

test('dry-run text output prints the effective Xiaoneng handoff', async () => {
  const { stdout } = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'dry-run',
    '--loop',
    'frontend-delivery',
    '--target-repository',
    'operateBusiness'
  ]);

  assert.match(stdout, /Execution: xiaoneng \(xiaoneng-agent, mounted-background\)/);
  assert.match(stdout, /Xiaoneng handoff: operateBusiness -> xiaoneng-agent\/SKILL\.md/);
  assert.match(stdout, /Effective orchestrator: xiaoneng-agent \(manifest-source\)/);
  assert.match(stdout, /Route evidence: entry=xiaoneng-agent\/SKILL\.md, manifest=harness\/runtime\/manifest\.yaml/);
  assert.match(stdout, /mode=PageImplementation, owner=watermelon-frontend-agent/);
  assert.match(stdout, /skills=fe-page-workflow,fe-typescript-safety/);
  assert.match(stdout, /Generator runs: 0/);
  assert.match(stdout, /Evaluator runs: 0/);
  assert.match(stdout, /Orchestrator: xiaobai \(xiaobai\.orchestrator\.agent\.yaml\)/);
  assert.match(stdout, /Resolved target: operateBusiness -> t-max -> xiaoneng/);
  assert.match(stdout, /Route source: explicit-repository/);
  assert.match(stdout, /Project route: t-max -> xiaoneng, repositories: 7/);
  assert.doesNotMatch(stdout, /Workflow stages:/);
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

test('app-a without an explicit background runtime stays on Xiaobai', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetProject: 'app-a',
    now: new Date('2026-09-04T00:00:00.000Z')
  });

  assert.equal(plan.orchestrator?.effective.agentId, 'xiaobai');
  assert.equal(plan.orchestrator?.effective.source, 'loop-config');
  assert.equal(plan.xiaoneng, undefined);
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

test('trunkFeeder project background mounts skill folder and trunkFeeder-ui repository', async () => {
  const projectRoot = path.join(workspaceRoot, 'projects', 'trunkFeeder');
  const project = await readYamlFile<{
    kind: string;
    id: string;
    background: { id: string; name: string; localPathKey: string; mount: string };
    repositories: Array<{ id: string; localPathKey: string; mount: string; remote: string }>;
  }>(path.join(projectRoot, '.loop', 'project.yaml'));

  assert.equal(project.kind, 'ProjectGroup');
  assert.equal(project.id, 'trunkFeeder');
  assert.equal(project.background.id, 'trunkFeeder');
  assert.equal(project.background.name, 'trunkFeeder');
  assert.equal(project.background.localPathKey, 'trunkFeeder');
  assert.equal(project.repositories.length, 1);
  assert.equal(project.repositories[0].id, 'trunkFeeder-ui');
  assert.equal(project.repositories[0].localPathKey, 'trunkFeeder-ui');
  assert.equal(project.repositories[0].remote, 'http://git.ane56-ins.com/T-MAX/trunkFeeder-ui');
  assert.match(project.background.mount, /mounts\/background\/trunkFeeder$/);
  assert.match(project.repositories[0].mount, /mounts\/repos\/trunkFeeder-ui$/);

  const packageJson = await readYamlFile<{ scripts: Record<string, string> }>(path.join(repoRoot, 'package.json'));
  assert.equal(packageJson.scripts['mount:trunkFeeder'], 'node workspace/projects/trunkFeeder/scripts/mount-local.mjs');

  const localPathsExample = await readText(path.join(projectRoot, '.loop', 'local.paths.yaml.example'));
  assert.match(localPathsExample, /trunkFeeder-ui\/skill/);
  assert.match(localPathsExample, /trunkFeeder-ui/);

  const skill = await readText(path.join(projectRoot, 'SKILL.md'));
  assert.match(skill, /项目背景名称：`trunkFeeder`/);
  assert.match(skill, /mount:trunkFeeder/);

  const readme = await readText(path.join(projectRoot, 'README.md'));
  assert.match(readme, /trunkFeeder-ui\/skill/);
  assert.match(readme, /workspace\/\.local\/trunkFeeder\/mounts\/repos\/trunkFeeder-ui/);
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
