import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { HarnessRuntime } from '../packages/harness-runtime/src/harnessRuntime';
import { GatePassStore, HumanGate } from '../packages/human-gate/src/humanGate';
import { createGateSubject } from '../packages/human-gate/src/subjectDigest';
import { canonicalizeJson, digestJsonHex } from '../packages/shared/src/canonicalDigest';
import {
  createStageEvent,
  projectStageTiming,
  StageEventStore
} from '../packages/execution-runtime/src/stageEvents';
import {
  ExecutionEventStore,
  projectExecutionTrace
} from '../packages/execution-runtime/src/executionEvents';
import { stageTimingMetricFromProjection } from '../packages/execution-runtime/src/timingMetrics';
import { ExecutionRuntime } from '../packages/execution-runtime/src/executionRuntime';
import { CodexCliAdapter } from '../packages/execution-runtime/src/codexCliAdapter';
import { TaskRuntime } from '../packages/task-runtime/src/taskRuntime';
import { generateCapabilityCatalog } from '../packages/capability-catalog/src/capabilityCatalog';
import { SkillContextResolver } from '../packages/skill-context-runtime/src/skillContextResolver';
import { chmod, mkdir, mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, pathExists, readText, readYamlFile } from '../packages/shared/src/fs';
import {
  BackgroundContextPlan,
  ConnectorSpec,
  HarnessRunSubmission,
  LegacyGatePassEvent,
  LoopSpec,
  WorkflowStagePlan
} from '../packages/shared/src/types';
import { validateWorkspace } from '../packages/shared/src/validation';
import { standardPageArtifactRoot } from '../packages/shared/src/taskArtifacts';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const execFileAsync = promisify(execFile);
const designSubject = {
  requirementBrief: 'Build the approved frontend flow.',
  sourceTrace: { type: 'local', ref: 'requirements/frontend.md' },
  targetRepositories: ['operateBusiness'],
  masterDesignPath: 'docs/frontend-master-design.md',
  repositoryDesignPaths: ['docs/operate-business-design.md']
};
const changedDesignSubject = { ...designSubject, masterDesignPath: 'docs/changed-design.md' };
const triageMergeSubject = {
  changedFiles: ['src/example.ts'],
  testResult: '68/68 passed',
  codeReviewResult: 'approved',
  pullRequestPlan: { branch: 'loop/example', target: 'main' }
};

async function createExecutionFixture(loopId: string) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-execution-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');
  if (loopId === 'ane-standard-page') {
    await mkdir(path.join(tempWorkspace, 'memory', 'loops', loopId), { recursive: true });
    await writeFile(path.join(tempWorkspace, 'memory', 'loops', loopId, 'state.md'), '# test state\n', 'utf8');
  }
  const loopPath = await findLoopSpec(tempWorkspace, loopId);
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot: tempWorkspace,
    loopPath,
    now: new Date('2026-08-10T00:00:00.000Z'),
    targetRepository: loopId === 'frontend-delivery' || loopId === 'ane-standard-page' ? 'operateBusiness' : undefined
  });
  return {
    tempRoot,
    workspaceRoot: tempWorkspace,
    memoryRoot: path.join(tempWorkspace, 'memory'),
    loop,
    plan
  };
}

async function createSkillContextFixture() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-skill-context-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  const sourceRoot = path.join(tempRoot, 'xiaoneng');
  const mount = path.join(tempWorkspace, '.local', 't-max', 'mounts', 'background', 'xiaoneng');
  await mkdir(path.dirname(mount), { recursive: true });
  await mkdir(path.join(sourceRoot, 'xiaoneng-agent'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'harness', 'runtime'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'harness', 'contracts', 'runtime'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'skills', 'op-ship-ops'), { recursive: true });
  await mkdir(path.join(sourceRoot, 'skills', 'op-ship-ops', 'references'), { recursive: true });
  await symlink(sourceRoot, mount, 'dir');

  await writeFile(
    path.join(sourceRoot, 'xiaoneng-agent', 'SKILL.md'),
    '# Xiaoneng Entry\n\nXIAONENG_ENTRY_CONTENT\n\n## FullWorkflow\n\nUse the manifest-selected owner and skills.\n',
    'utf8'
  );
  await writeFile(
    path.join(sourceRoot, 'skills', 'op-ship-ops', 'SKILL.md'),
    '# Ship Ops\n\nOWNER_SKILL_CONTENT\n\n## References\n\n- `references/build-gate.md`\n',
    'utf8'
  );
  await writeFile(
    path.join(sourceRoot, 'skills', 'op-ship-ops', 'references', 'build-gate.md'),
    '# Build Gate\n\nSELECTED_REFERENCE_CONTENT\n',
    'utf8'
  );
  await writeFile(
    path.join(sourceRoot, 'harness', 'runtime', 'manifest.yaml'),
    `name: xiaoneng-harness
version: 1.0.0
mode: active
activation: active
contractResolution: ready
skillContext:
  contract:
    path: contracts/runtime/skill-context.schema.json
    version: 1.0.0
  entryPath: xiaoneng-agent/SKILL.md
  manifestPath: harness/runtime/manifest.yaml
  hashAlgorithm: sha256
orchestrator: xiaoneng-agent
architecture:
  singleOwnerPerStage: true
executionModes:
  defaultMode: auto_minimal
  fullWorkflowTrigger: explicit_user_only
  testTrigger: explicit_user_or_post_integration_confirmation
  buildTrigger: explicit_user_only
  selfCheckScope: lightweight_local_code_checks
  selfCheckCannotClaim: []
  modes:
    FullWorkflow:
      stateRef: full_workflow
      ownerAgent: xiaoneng-agent
      ownerSkills:
        - op-ship-ops
      requiresStageArtifacts: true
      nextState: understand_requirement
stageOrder:
  - understand_requirement
stages:
  understand_requirement:
    ownerAgent: xiaoneng-agent
`,
    'utf8'
  );
  await writeFile(
    path.join(sourceRoot, 'harness', 'contracts', 'runtime', 'skill-context.schema.json'),
    `${JSON.stringify(skillContextTestSchema(), null, 2)}\n`,
    'utf8'
  );
  const outsideFile = path.join(tempRoot, 'outside-background.md');
  await writeFile(outsideFile, 'MUST_NOT_BE_LOADED\n', 'utf8');
  await symlink(outsideFile, path.join(sourceRoot, 'unregistered-link.md'));
  await execFileAsync('git', ['init', '-q'], { cwd: sourceRoot });
  await execFileAsync('git', ['add', '-A'], { cwd: sourceRoot });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'fixture'],
    { cwd: sourceRoot }
  );

  const plan: BackgroundContextPlan = {
    status: 'planned',
    kind: 'skill-context',
    contractVersion: '1.0.0',
    projectId: 't-max',
    backgroundId: 'xiaoneng',
    sourceMount: path.relative(tempWorkspace, mount),
    manifestPath: 'harness/runtime/manifest.yaml',
    contractPath: 'harness/contracts/runtime/skill-context.schema.json',
    executionMode: 'FullWorkflow',
    maxCharacters: 18_000
  };
  return { tempRoot, workspaceRoot: tempWorkspace, sourceRoot, plan };
}

function skillContextTestSchema() {
  const digest = { type: 'string', pattern: '^[0-9a-f]{64}$' };
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'object',
    additionalProperties: false,
    required: [
      'contractVersion',
      'skillId',
      'skillCommit',
      'entryPath',
      'entryHash',
      'manifestPath',
      'manifestDigest',
      'executionMode',
      'ownerAgent',
      'ownerSkills',
      'selectedReferences',
      'contextDigest'
    ],
    properties: {
      contractVersion: { const: '1.0.0' },
      skillId: { type: 'string', minLength: 1 },
      skillCommit: { type: 'string', pattern: '^[0-9a-f]{40}$' },
      entryPath: { type: 'string', minLength: 1 },
      entryHash: digest,
      manifestPath: { type: 'string', minLength: 1 },
      manifestDigest: digest,
      executionMode: { type: 'string', minLength: 1 },
      ownerAgent: { type: 'string', minLength: 1 },
      ownerSkills: { type: 'array', items: { type: 'string', minLength: 1 } },
      selectedReferences: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'path', 'digest'],
          properties: {
            id: { type: 'string' },
            path: { type: 'string' },
            digest
          }
        }
      },
      contextDigest: digest
    }
  };
}

function validCodingSubmission(runId: string, taskId: string): HarnessRunSubmission {
  return {
    runId,
    taskId,
    agentId: 'generator',
    harnessId: 'coding-harness',
    startedAt: '2026-08-10T00:00:00.000Z',
    finishedAt: '2026-08-10T00:00:02.000Z',
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 8000,
    toolsUsed: ['read_file', 'run_tests', 'git_diff'],
    completedConditions: ['code_changed', 'tests_attempted', 'summary_written'],
    output: {
      summary: 'Changed the target file.',
      changedFiles: ['src/example.ts'],
      testResult: 'passed',
      nextRecommendation: 'review'
    },
    evidence: [
      { checkId: 'code_changed', type: 'diff', value: 'target diff exists' },
      { checkId: 'tests_attempted', type: 'test', value: 'focused tests passed' },
      { checkId: 'summary_written', type: 'file', value: 'summary output' }
    ]
  };
}

function validStageSubmission(
  stage: WorkflowStagePlan,
  runId: string,
  taskId: string,
  agentId: string,
  harnessId: string
): HarnessRunSubmission {
  return {
    runId,
    taskId,
    agentId,
    harnessId,
    startedAt: '2026-08-10T00:00:00.000Z',
    finishedAt: '2026-08-10T00:00:02.000Z',
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 8000,
    toolsUsed: ['read_file', 'run_tests', 'git_diff'],
    completedConditions: [...stage.requiredChecks],
    output: Object.fromEntries(stage.outputs.map((field) => [field, `${field} result`])),
    evidence: stage.requiredChecks.map((checkId) => ({
      checkId,
      type: 'review' as const,
      value: `${checkId} independently verified`
    }))
  };
}

async function generateMonitorSnapshot(memoryRoot: string) {
  const { stdout } = await execFileAsync('node', [
    'workspace/monitoring/scripts/generate-monitor-data.mjs',
    '--stdout',
    '--memory-root',
    memoryRoot
  ]);
  return JSON.parse(stdout) as {
    timing: {
      status: string;
      sources: Array<{
        loopId: string;
        selectedRunId: string | null;
        status: string;
        errors: string[];
      }>;
      stages: Array<{
        loopId: string;
        runId: string | null;
        taskId: string | null;
        stageId: string;
        attempt: number | null;
        status: string;
        valid: boolean;
        enteredAt: string | null;
        durationMs: number | null;
        activeMs: number | null;
        waitingMs: number | null;
        waitingReason: string | null;
        evidence: string;
        errors: string[];
      }>;
      requests: Array<{
        runId: string | null;
        taskId: string;
        status: string;
        durationMs: number | null;
      }>;
      metrics: {
        realTimingCount: number;
        legacySimulationCount: number;
      };
      aggregate: {
        stageAggregates: Array<{
          loopId: string;
          stageId: string;
          owner: string;
          status: string;
          sampleCount: number;
          measurementRate: number;
          waitingRatio: number | null;
        }>;
      };
    };
  };
}

async function prepareStandardPageTask(
  fixture: Awaited<ReturnType<typeof createExecutionFixture>>,
  taskId: string
) {
  assert(fixture.plan.backgroundContext);
  const taskRuntime = new TaskRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    now: () => new Date('2026-08-10T00:00:00.000Z')
  });
  await taskRuntime.create({
    taskId,
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      subject: { title: 'standard page fixture' },
      requestedActions: ['read']
    }
  });
  const context = await new SkillContextResolver(fixture.workspaceRoot).resolve(fixture.plan.backgroundContext);
  const root = standardPageArtifactRoot(fixture.workspaceRoot, fixture.plan, taskId);
  assert(root);
  return { context, root };
}

async function markDependencyPassed(
  fixture: Awaited<ReturnType<typeof createExecutionFixture>>,
  runId: string,
  taskId: string,
  stageId: string
): Promise<void> {
  const stage = fixture.plan.workflow?.stages.find((item) => item.id === stageId);
  assert(stage);
  const owner = (stage.agent ?? stage.evaluator ?? fixture.loop.metadata.owner).replace(/\.agent\.yaml$/, '');
  const scope = {
    loopId: fixture.loop.metadata.id,
    runId,
    taskId,
    stageId,
    attempt: 1,
    stageKind: stage.kind,
    owner
  };
  const store = new StageEventStore(fixture.memoryRoot, fixture.loop.metadata.id);
  await store.append(createStageEvent({ ...scope, eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' }));
  await store.append(createStageEvent({ ...scope, eventType: 'passed', occurredAt: '2026-08-10T00:00:01.000Z' }));
}

function standardPageContract(
  fixture: Awaited<ReturnType<typeof createExecutionFixture>>,
  context: Awaited<ReturnType<SkillContextResolver['resolve']>>,
  taskId: string,
  importConfig: Record<string, unknown> = {
    enabled: false,
    ruleRef: 'none',
    templateRef: 'none',
    adapterRef: 'none'
  }
) {
  const contract = {
    contractVersion: '2.0.0',
    taskId,
    projectId: 't-max',
    repositoryId: fixture.plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId,
    pageType: 'StandardPage',
    standardPageProfile: 'standard-list',
    routes: [],
    menus: [],
    fields: [],
    apis: [],
    import: importConfig,
    references: [],
    rules: [],
    sourceEvidence: [],
    contextDigest: context.skillContext.contextDigest
  };
  return { ...contract, contractDigest: digestJsonHex(contract) };
}

async function executeStandardPageStage(
  fixture: Awaited<ReturnType<typeof createExecutionFixture>>,
  input: {
    runId: string;
    taskId: string;
    stageId: string;
    calls: () => void;
  }
) {
  return new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: `executor-${input.runId}`
  }).execute(
    {
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stageId,
      subject: {}
    },
    {
      id: 'fake-standard-page-adapter',
      async execute() {
        input.calls();
        return { status: 'blocked' as const, reason: 'must not run', evidence: [] };
      }
    }
  );
}

test('workspace validates against schemas and referenced files', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const result = await validateWorkspace(workspaceRoot, loopPath);

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('skill context resolver assembles a contract from registered sources only', async () => {
  const fixture = await createSkillContextFixture();
  const context = await new SkillContextResolver(fixture.workspaceRoot).resolve(fixture.plan);

  assert.equal(context.kind, 'skill-context');
  assert.equal(context.projectId, 't-max');
  assert.equal(context.backgroundId, 'xiaoneng');
  assert.equal(context.skillContext.contractVersion, '1.0.0');
  assert.equal(context.skillContext.skillId, 'xiaoneng-agent');
  assert.match(context.skillContext.skillCommit, /^[0-9a-f]{40}$/);
  assert.equal(context.skillContext.executionMode, 'FullWorkflow');
  assert.equal(context.skillContext.ownerAgent, 'xiaoneng-agent');
  assert.deepEqual(context.skillContext.ownerSkills, ['op-ship-ops']);
  assert.deepEqual(context.skillContext.selectedReferences.map((reference) => reference.path), [
    'skills/op-ship-ops/references/build-gate.md'
  ]);
  assert.match(context.skillContext.contextDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(
    context.documents.map((document) => document.path),
    [
      'xiaoneng-agent/SKILL.md',
      'harness/runtime/manifest.yaml',
      'skills/op-ship-ops/SKILL.md',
      'skills/op-ship-ops/references/build-gate.md'
    ]
  );
  assert.match(context.documents[0].content, /XIAONENG_ENTRY_CONTENT/);
  assert.match(context.documents[1].content, /FullWorkflow/);
  assert.match(context.documents[2].content, /OWNER_SKILL_CONTENT/);
  assert.match(context.documents[3].content, /SELECTED_REFERENCE_CONTENT/);
  assert.doesNotMatch(JSON.stringify(context), /MUST_NOT_BE_LOADED|unregistered-link/);
  assert(context.characters <= fixture.plan.maxCharacters);
});

test('skill context resolver fails closed when the declared contract is missing', async () => {
  const fixture = await createSkillContextFixture();
  await assert.rejects(
    new SkillContextResolver(fixture.workspaceRoot).resolve({
      ...fixture.plan,
      contractPath: 'harness/contracts/runtime/missing.schema.json'
    }),
    /SKILL_CONTEXT_SOURCE_MISSING/
  );
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
  assert.equal(plan.backgroundContext, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'backgroundContext'), false);
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
    subject: designSubject,
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
      subject: designSubject,
      now: new Date('2026-08-10T00:01:00.000Z')
    },
    [pass]
  );

  assert.equal(decision.status, 'passed');
  assert.deepEqual(decision.requiredGates, ['human-design-approval']);
  assert.deepEqual(decision.satisfiedGates, ['human-design-approval']);
  assert.equal(decision.passes[0]?.passId, pass.passId);
});

test('gate subjects are canonical, order-sensitive for arrays, and reject missing fields', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = loop.humanGate.gates.find((item) => item.id === 'human-design-approval');
  assert(gate);

  const reorderedSubject = {
    repositoryDesignPaths: ['docs/operate-business-design.md'],
    masterDesignPath: 'docs/frontend-master-design.md',
    targetRepositories: ['operateBusiness'],
    sourceTrace: { ref: 'requirements/frontend.md', type: 'local' },
    requirementBrief: 'Build the approved frontend flow.'
  };
  assert.equal(createGateSubject(gate, designSubject).subjectDigest, createGateSubject(gate, reorderedSubject).subjectDigest);
  assert.notEqual(
    createGateSubject(gate, { ...designSubject, repositoryDesignPaths: ['a', 'b'] }).subjectDigest,
    createGateSubject(gate, { ...designSubject, repositoryDesignPaths: ['b', 'a'] }).subjectDigest
  );
  assert.throws(
    () => createGateSubject(gate, { ...designSubject, masterDesignPath: undefined }),
    /rejects undefined/
  );
  const { masterDesignPath: _missing, ...missingSubject } = designSubject;
  assert.throws(() => createGateSubject(gate, missingSubject), /missing field: masterDesignPath/);
});

test('canonical digest is shared, stable for object order, array-order-sensitive, and rejects invalid Unicode', () => {
  assert.equal(canonicalizeJson({ b: 2, a: 1 }), '{"a":1,"b":2}');
  assert.equal(digestJsonHex({ b: 2, a: 1 }), digestJsonHex({ a: 1, b: 2 }));
  assert.notEqual(digestJsonHex({ values: ['a', 'b'] }), digestJsonHex({ values: ['b', 'a'] }));
  assert.equal(digestJsonHex({ text: 'e\u0301' }), digestJsonHex({ text: 'e\u0301' }));
  assert.throws(() => canonicalizeJson('\ud800'), /invalid Unicode/);
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
    subject: designSubject,
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
    subject: designSubject,
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
      subject: changedDesignSubject,
      now: new Date('2026-08-10T00:01:00.000Z')
    },
    [pass]
  );
  assert.equal(changed.status, 'blocked');
  assert.match(changed.blockingReasons.join('\n'), /subject changed/);

  const expired = gate.check(
    {
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      subject: designSubject,
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
      subject: designSubject,
      now: new Date('2026-08-10T00:03:00.000Z')
    },
    [pass, revoked]
  );
  assert.equal(revokedDecision.status, 'blocked');
  assert.match(revokedDecision.blockingReasons.join('\n'), /is revoked/);
});

test('gate policy changes and legacy passes fail closed', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const gate = new HumanGate(loop);
  const pass = gate.grant({
    gateId: 'human-design-approval',
    runId: 'run-gate-policy',
    taskId: 'task-gate-policy',
    stageId: 'frontend-implementation',
    issuer: 'wusheng',
    subject: designSubject,
    evidence: [
      { type: 'review', value: 'design review report' },
      { type: 'human-approval', value: 'owner approved the design' }
    ]
  });

  const changedLoop = structuredClone(loop);
  const changedGate = changedLoop.humanGate.gates.find((item) => item.id === 'human-design-approval');
  assert(changedGate);
  changedGate.subjectFields.push('approvalVersion');
  const changedDecision = new HumanGate(changedLoop).check(
    {
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      subject: { ...designSubject, approvalVersion: 1 }
    },
    [pass]
  );
  assert.equal(changedDecision.status, 'blocked');
  assert.match(changedDecision.blockingReasons.join('\n'), /policy changed/);

  const { canonicalization: _canonicalization, policyDigest: _policyDigest, ...legacyFields } = pass;
  const legacyPass: LegacyGatePassEvent = { ...legacyFields, version: 1 };
  const legacyDecision = gate.check(
    { runId: pass.runId, taskId: pass.taskId, stageId: pass.stageId, subject: designSubject },
    [legacyPass]
  );
  assert.equal(legacyDecision.status, 'blocked');
  assert.match(legacyDecision.blockingReasons.join('\n'), /legacy passes/);
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
    subject: designSubject,
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

test('stage timing projects active and waiting time from valid events', () => {
  const scope = {
    loopId: 'loop-stage',
    runId: 'run-stage',
    taskId: 'task-stage',
    stageId: 'verification',
    attempt: 1,
    stageKind: 'review',
    owner: 'evaluator'
  };
  const events = [
    createStageEvent({ ...scope, eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' }),
    createStageEvent({
      ...scope,
      eventType: 'first_action',
      occurredAt: '2026-08-10T00:00:01.000Z',
      evidence: [{ type: 'command', value: 'started evaluator' }]
    }),
    createStageEvent({
      ...scope,
      eventType: 'waiting_started',
      occurredAt: '2026-08-10T00:00:03.000Z',
      waitingReason: 'tool_running'
    }),
    createStageEvent({
      ...scope,
      eventType: 'waiting_ended',
      occurredAt: '2026-08-10T00:00:08.000Z',
      waitingReason: 'tool_running'
    }),
    createStageEvent({
      ...scope,
      eventType: 'passed',
      occurredAt: '2026-08-10T00:00:10.000Z',
      evidence: [{ type: 'test', value: 'focused test passed' }]
    })
  ];

  const projection = projectStageTiming(events, scope);
  assert.equal(projection.valid, true);
  assert.equal(projection.status, 'passed');
  assert.equal(projection.enteredAt, '2026-08-10T00:00:00.000Z');
  assert.equal(projection.firstActionAt, '2026-08-10T00:00:01.000Z');
  assert.equal(projection.exitedAt, '2026-08-10T00:00:10.000Z');
  assert.equal(projection.durationMs, 10_000);
  assert.equal(projection.waitingMs, 5_000);
  assert.equal(projection.activeMs, 5_000);
  assert.equal(projection.waitingReason, 'tool_running');
  assert.equal(projection.evidence.length, 2);
});

test('stage timing preserves terminal status and retry attempts in the append-only store', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-stage-events-'));
  const store = new StageEventStore(memoryRoot, 'loop-retry');
  const base = {
    loopId: 'loop-retry',
    runId: 'run-retry',
    taskId: 'task-retry',
    stageId: 'implementation',
    stageKind: 'coding',
    owner: 'generator'
  };
  const events = [
    createStageEvent({ ...base, attempt: 1, eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' }),
    createStageEvent({ ...base, attempt: 1, eventType: 'blocked', occurredAt: '2026-08-10T00:00:02.000Z' }),
    createStageEvent({ ...base, attempt: 2, eventType: 'entered', occurredAt: '2026-08-10T00:01:00.000Z' }),
    createStageEvent({ ...base, attempt: 2, eventType: 'passed', occurredAt: '2026-08-10T00:01:03.000Z' })
  ];
  for (const item of events) await store.append(item);

  const stored = await store.readAll();
  assert.equal(stored.length, 4);
  assert.equal(projectStageTiming(stored, { ...base, attempt: 1 }).status, 'blocked');
  assert.equal(projectStageTiming(stored, { ...base, attempt: 2 }).status, 'passed');
  assert.equal(store.filePath(), path.join(memoryRoot, 'loops', 'loop-retry', 'stage-events.jsonl'));

  for (const status of ['failed', 'blocked'] as const) {
    const scope = { ...base, runId: `run-${status}`, attempt: 1 };
    const projection = projectStageTiming(
      [
        createStageEvent({ ...scope, eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' }),
        createStageEvent({ ...scope, eventType: status, occurredAt: '2026-08-10T00:00:01.000Z' })
      ],
      scope
    );
    assert.equal(projection.status, status);
    assert.equal(projection.valid, true);
    assert.equal(projection.waitingMs, 0);
    assert.equal(projection.activeMs, 1_000);
  }
});

test('execution events preserve reconstructable model and tool facts with private spill files', async () => {
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-execution-events-'));
  const store = new ExecutionEventStore(memoryRoot, 'loop-events', 'run-events', {
    maxInlineBytes: 1024,
    now: () => new Date('2026-08-10T00:00:00.000Z')
  });
  const scope = {
    loopId: 'loop-events',
    runId: 'run-events',
    taskId: 'task-events',
    stageId: 'review',
    attempt: 1
  };
  await store.append({ ...scope, actor: 'executor', eventType: 'prompt/assembled', data: { requestId: 'request-1' } });
  await store.append({ ...scope, actor: 'executor', eventType: 'model/requested', data: { requestId: 'request-1' } });
  await store.append({ ...scope, actor: 'executor', eventType: 'tool/call', data: { callId: 'call-1' } });
  await store.append({ ...scope, actor: 'executor', eventType: 'tool/result', data: { callId: 'call-1' } });
  await store.append({ ...scope, actor: 'executor', eventType: 'model/completed', data: { requestId: 'request-1' } });
  const spilled = await store.append({
    ...scope,
    actor: 'runtime',
    eventType: 'executor/completed',
    data: { output: 'x'.repeat(2048) }
  });

  const events = await store.readAll();
  const projection = projectExecutionTrace(events);
  assert.equal(projection.valid, true, projection.errors.join('\n'));
  assert.equal(projection.reconstructable, true);
  assert.equal(projection.modelRequests, 1);
  assert.equal(projection.modelCompletions, 1);
  assert.equal(projection.toolCalls, 1);
  assert.equal(projection.toolResults, 1);
  assert.equal(spilled.data.spilled, true);
  const spillPath = path.join(memoryRoot, String(spilled.data.path));
  assert.equal(await pathExists(spillPath), true);
  assert.equal((await stat(spillPath)).mode & 0o777, 0o600);
  await assert.rejects(
    store.append({
      ...scope,
      actor: 'executor',
      eventType: 'tool/result',
      data: { callId: 'unknown-call' }
    }),
    /has no tool\/call event/
  );
});

test('stage timing rejects out-of-order, duplicate, and terminal-with-open-wait streams', async () => {
  const scope = {
    loopId: 'loop-invalid',
    runId: 'run-invalid',
    taskId: 'task-invalid',
    stageId: 'review',
    attempt: 1,
    stageKind: 'review',
    owner: 'evaluator'
  };
  const entered = createStageEvent({ ...scope, eventType: 'entered', occurredAt: '2026-08-10T00:00:02.000Z' });
  const outOfOrder = createStageEvent({
    ...scope,
    eventType: 'first_action',
    occurredAt: '2026-08-10T00:00:01.000Z'
  });
  const orderedProjection = projectStageTiming([entered, outOfOrder], scope);
  assert.equal(orderedProjection.status, 'unmeasured');
  assert.match(orderedProjection.errors.join('\n'), /earlier than the previous event/);

  const duplicateEntered = createStageEvent({
    ...scope,
    eventType: 'entered',
    occurredAt: '2026-08-10T00:00:03.000Z'
  });
  const duplicateProjection = projectStageTiming([entered, duplicateEntered], scope);
  assert.equal(duplicateProjection.status, 'unmeasured');
  assert.match(duplicateProjection.errors.join('\n'), /duplicate entered/);

  const openWaitProjection = projectStageTiming(
    [
      entered,
      createStageEvent({
        ...scope,
        eventType: 'waiting_started',
        occurredAt: '2026-08-10T00:00:03.000Z',
        waitingReason: 'approval_required'
      }),
      createStageEvent({ ...scope, eventType: 'blocked', occurredAt: '2026-08-10T00:00:04.000Z' })
    ],
    scope
  );
  assert.equal(openWaitProjection.status, 'unmeasured');
  assert.equal(openWaitProjection.waitingReason, 'approval_required');
  assert.match(openWaitProjection.errors.join('\n'), /terminal event cannot occur while waiting/);

  const missingProjection = projectStageTiming([], scope);
  assert.equal(missingProjection.status, 'unmeasured');
  assert.equal(missingProjection.waitingReason, 'missing_instrumentation');

  const store = new StageEventStore(await mkdtemp(path.join(tmpdir(), 'loop-invalid-events-')), scope.loopId);
  await store.append(entered);
  await assert.rejects(() => store.append(duplicateEntered), /duplicate entered/);
});

test('monitoring projects the latest real run and keeps missing or invalid streams unmeasured', async () => {
  const validMemoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-monitor-valid-'));
  const eventPath = path.join(validMemoryRoot, 'loops', 'morning-triage', 'stage-events.jsonl');
  await mkdir(path.dirname(eventPath), { recursive: true });
  const base = {
    loopId: 'morning-triage',
    taskId: 'task-monitor',
    stageId: 'triage-discovery',
    attempt: 1,
    stageKind: 'intake',
    owner: 'generator'
  };
  const events = [
    createStageEvent({ ...base, runId: 'run-old', eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' }),
    createStageEvent({ ...base, runId: 'run-old', eventType: 'passed', occurredAt: '2026-08-10T00:00:01.000Z' }),
    createStageEvent({ ...base, runId: 'run-new', eventType: 'entered', occurredAt: '2026-08-10T01:00:00.000Z' }),
    createStageEvent({ ...base, runId: 'run-new', eventType: 'first_action', occurredAt: '2026-08-10T01:00:01.000Z' }),
    createStageEvent({
      ...base,
      runId: 'run-new',
      eventType: 'waiting_started',
      occurredAt: '2026-08-10T01:00:02.000Z',
      waitingReason: 'tool_running'
    }),
    createStageEvent({
      ...base,
      runId: 'run-new',
      eventType: 'waiting_ended',
      occurredAt: '2026-08-10T01:00:07.000Z',
      waitingReason: 'tool_running'
    }),
    createStageEvent({ ...base, runId: 'run-new', eventType: 'passed', occurredAt: '2026-08-10T01:00:10.000Z' })
  ];
  await writeFile(eventPath, `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  const realMetric = stageTimingMetricFromProjection(
    projectStageTiming(events.filter((event) => event.runId === 'run-new'), {
      ...base,
      runId: 'run-new'
    })
  );
  assert(realMetric);
  const metricPath = path.join(validMemoryRoot, 'loops', 'morning-triage', 'metrics.jsonl');
  await writeFile(
    metricPath,
    `${JSON.stringify({ runId: 'sim-legacy', mode: 'simulation', stages: 1 })}\n${JSON.stringify(realMetric)}\n`,
    'utf8'
  );

  const validSnapshot = await generateMonitorSnapshot(validMemoryRoot);
  const source = validSnapshot.timing.sources.find((item) => item.loopId === 'morning-triage');
  assert.equal(source?.selectedRunId, 'run-new');
  assert.equal(source?.status, 'partial');
  const measured = validSnapshot.timing.stages.find(
    (stage) => stage.loopId === 'morning-triage' && stage.stageId === 'triage-discovery'
  );
  assert.equal(measured?.status, 'passed');
  assert.equal(measured?.valid, true);
  assert.equal(measured?.durationMs, 10_000);
  assert.equal(measured?.activeMs, 5_000);
  assert.equal(measured?.waitingMs, 5_000);
  assert.equal(measured?.evidence, 'memory/loops/morning-triage/stage-events.jsonl');
  assert.equal(validSnapshot.timing.metrics.realTimingCount, 1);
  assert.equal(validSnapshot.timing.metrics.legacySimulationCount, 1);
  const request = validSnapshot.timing.requests.find(
    (item) => item.runId === 'run-new' && item.taskId === 'task-monitor'
  );
  assert.equal(request?.status, 'partial');
  assert.equal(request?.durationMs, 10_000);
  const stageAggregate = validSnapshot.timing.aggregate.stageAggregates.find(
    (item) => item.loopId === 'morning-triage' && item.stageId === 'triage-discovery'
  );
  assert.equal(stageAggregate?.status, 'measured');
  assert.equal(stageAggregate?.sampleCount, 2);
  assert.equal(stageAggregate?.measurementRate, 1);
  assert.equal(stageAggregate?.waitingRatio, 5_000 / 11_000);
  const missing = validSnapshot.timing.stages.find(
    (stage) => stage.loopId === 'morning-triage' && stage.stageId === 'finding-isolation'
  );
  assert.equal(missing?.status, 'unmeasured');
  assert.equal(missing?.durationMs, null);
  assert.equal(missing?.waitingReason, 'missing_instrumentation');

  const invalidMemoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-monitor-invalid-'));
  const invalidEventPath = path.join(invalidMemoryRoot, 'loops', 'morning-triage', 'stage-events.jsonl');
  await mkdir(path.dirname(invalidEventPath), { recursive: true });
  const invalidEvents = [
    createStageEvent({ ...base, runId: 'run-invalid', eventType: 'entered', occurredAt: '2026-08-10T02:00:02.000Z' }),
    createStageEvent({ ...base, runId: 'run-invalid', eventType: 'first_action', occurredAt: '2026-08-10T02:00:01.000Z' })
  ];
  await writeFile(invalidEventPath, `${invalidEvents.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8');
  const invalidSnapshot = await generateMonitorSnapshot(invalidMemoryRoot);
  const invalid = invalidSnapshot.timing.stages.find(
    (stage) => stage.loopId === 'morning-triage' && stage.stageId === 'triage-discovery'
  );
  assert.equal(invalid?.status, 'unmeasured');
  assert.equal(invalid?.valid, false);
  assert.equal(invalid?.durationMs, null);
  assert.equal(invalid?.activeMs, null);
  assert.match(invalid?.errors.join('\n') ?? '', /earlier than the previous event/);

  const corruptMemoryRoot = await mkdtemp(path.join(tmpdir(), 'loop-monitor-corrupt-'));
  const corruptEventPath = path.join(corruptMemoryRoot, 'loops', 'morning-triage', 'stage-events.jsonl');
  await mkdir(path.dirname(corruptEventPath), { recursive: true });
  await writeFile(corruptEventPath, `${JSON.stringify(events[2])}\n{not-json\n`, 'utf8');
  const corruptSnapshot = await generateMonitorSnapshot(corruptMemoryRoot);
  const corruptSource = corruptSnapshot.timing.sources.find((item) => item.loopId === 'morning-triage');
  assert.equal(corruptSource?.status, 'invalid');
  assert.match(corruptSource?.errors.join('\n') ?? '', /invalid JSON/);
  assert.equal(
    corruptSnapshot.timing.stages
      .filter((stage) => stage.loopId === 'morning-triage')
      .every((stage) => stage.status === 'unmeasured' && stage.durationMs === null),
    true
  );
  assert.doesNotMatch(JSON.stringify(corruptSnapshot), new RegExp(corruptMemoryRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('execution runtime checks action gates before the adapter and Harness after completion', async () => {
  const fixture = await createExecutionFixture('morning-triage');
  const stage = fixture.plan.workflow?.stages.find((item) => item.id === 'triage-discovery');
  assert(stage);
  const executionGateNow = new Date();
  const gate = new HumanGate(fixture.loop);
  const passStore = new GatePassStore(fixture.memoryRoot, fixture.loop.metadata.id);
  await passStore.append(
    gate.grant({
      gateId: 'merge-approval',
      runId: 'run-execution-pass',
      taskId: 'task-execution-pass',
      issuer: 'wusheng',
      subject: triageMergeSubject,
      evidence: [
        { type: 'test', value: 'unit tests passed' },
        { type: 'review', value: 'independent review passed' },
        { type: 'human-approval', value: 'owner approved merge' }
      ],
      now: executionGateNow
    })
  );

  let calls = 0;
  const result = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-test-pass',
    now: () => new Date(executionGateNow.getTime() + 60_000)
  }).execute(
    {
      runId: 'run-execution-pass',
      taskId: 'task-execution-pass',
      stageId: 'triage-discovery',
      actions: ['merge'],
      subject: triageMergeSubject
    },
    {
      id: 'fake-executor',
      async execute(input) {
        calls += 1;
        assert.equal(input.stage.id, 'triage-discovery');
        return {
          status: 'completed',
          submission: validStageSubmission(stage, input.runId, input.taskId, 'generator', 'coding-harness'),
          evidence: []
        };
      }
    }
  );

  assert.equal(result.status, 'passed', result.reasons.join('\n'));
  assert.equal(result.gateDecision?.status, 'passed');
  assert.equal(result.harnessResult?.status, 'passed');
  assert.equal(result.stageTiming?.status, 'passed');
  assert.equal(result.stageTiming?.valid, true);
  assert.equal(result.stageTiming?.durationMs, 0);
  assert.equal(result.stageTiming?.activeMs, 0);
  assert.equal(result.stageTiming?.waitingMs, 0);
  assert.equal(result.timingMetric?.status, 'written');
  assert.equal(calls, 1);
  assert.deepEqual(result.stageEvents.map((event) => event.eventType), [
    'entered',
    'first_action',
    'waiting_started',
    'waiting_ended',
    'passed'
  ]);
  assert.deepEqual(result.executionEvents.map((event) => event.eventType), [
    'gate/decision',
    'executor/completed',
    'harness/verdict'
  ]);
  assert.equal(result.authority.scope, 'local_single_executor');
});

test('execution runtime blocks missing dependencies and stage gates without invoking the adapter', async () => {
  const fixture = await createExecutionFixture('frontend-delivery');
  const dependencyStore = new StageEventStore(fixture.memoryRoot, fixture.loop.metadata.id);
  const dependencyScope = {
    loopId: fixture.loop.metadata.id,
    runId: 'run-execution-blocked',
    taskId: 'task-execution-blocked',
    stageId: 'human-design-approval',
    attempt: 1,
    stageKind: 'human-gate',
    owner: 'wusheng'
  };
  await dependencyStore.append(
    createStageEvent({ ...dependencyScope, eventType: 'entered', occurredAt: '2026-08-10T00:00:00.000Z' })
  );
  await dependencyStore.append(
    createStageEvent({ ...dependencyScope, eventType: 'passed', occurredAt: '2026-08-10T00:00:01.000Z' })
  );

  let calls = 0;
  const adapter = {
    id: 'fake-executor',
    async execute() {
      calls += 1;
      return { status: 'completed' as const, submission: {}, evidence: [] };
    }
  };
  const runtime = new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-test-blocked',
    now: () => new Date('2026-08-10T00:02:00.000Z')
  });
  const missingGate = await runtime.execute(
    {
      runId: 'run-execution-blocked',
      taskId: 'task-execution-blocked',
      stageId: 'frontend-implementation',
      subject: designSubject
    },
    adapter
  );
  assert.equal(missingGate.status, 'blocked');
  assert.equal(missingGate.gateDecision?.status, 'blocked');
  assert.equal(missingGate.stageTiming?.status, 'blocked');
  assert.equal(missingGate.stageTiming?.valid, true);
  assert.equal(missingGate.stageTiming?.durationMs, 0);
  assert.equal(missingGate.timingMetric?.status, 'written');
  assert.match(missingGate.reasons.join('\n'), /no active pass/);
  assert.equal(calls, 0);
  assert.deepEqual(missingGate.stageEvents.map((event) => event.eventType), ['entered', 'blocked']);
  assert.deepEqual(missingGate.executionEvents.map((event) => event.eventType), ['gate/decision']);

  const passPath = path.join(fixture.memoryRoot, 'loops', fixture.loop.metadata.id, 'passes.jsonl');
  await mkdir(path.dirname(passPath), { recursive: true });
  await writeFile(passPath, '{not-json\n', 'utf8');
  const corruptStore = await runtime.execute(
    {
      runId: 'run-execution-corrupt-gate-store',
      taskId: 'task-execution-corrupt-gate-store',
      stageId: 'requirement-intake',
      actions: ['coding'],
      subject: designSubject
    },
    adapter
  );
  assert.equal(corruptStore.status, 'blocked');
  assert.match(corruptStore.reasons.join('\n'), /GatePass store unavailable/);
  assert.equal(calls, 0);

  const dependencyBlocked = await runtime.execute(
    {
      runId: 'run-execution-dependency',
      taskId: 'task-execution-dependency',
      stageId: 'target-repository-resolution',
      subject: {}
    },
    adapter
  );
  assert.equal(dependencyBlocked.status, 'blocked');
  assert.match(dependencyBlocked.reasons.join('\n'), /Dependency stage is not passed/);
  assert.equal(calls, 0);
});

test('execution runtime fails only the opted-in run when skill context cannot be loaded', async () => {
  const fixture = await createExecutionFixture('frontend-delivery');
  const skillFixture = await createSkillContextFixture();
  const fixtureMount = path.join(fixture.workspaceRoot, '.test-skill-context');
  await symlink(skillFixture.sourceRoot, fixtureMount, 'dir');
  assert(fixture.plan.backgroundContext);
  fixture.plan.backgroundContext.sourceMount = '.test-skill-context';
  fixture.plan.backgroundContext.contractPath = 'harness/contracts/runtime/missing.schema.json';
  let calls = 0;
  const result = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-test-background-failure'
  }).execute(
    {
      runId: 'run-background-failure',
      taskId: 'task-background-failure',
      stageId: 'requirement-intake',
      subject: {}
    },
    {
      id: 'fake-executor',
      async execute() {
        calls += 1;
        return { status: 'blocked', reason: 'must not run', evidence: [] };
      }
    }
  );

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /Background context loading failed closed/);
  assert.match(result.reasons.join('\n'), /SKILL_CONTEXT_SOURCE_MISSING/);
  assert.equal(calls, 0);
  assert.deepEqual(result.stageEvents.map((event) => event.eventType), ['entered', 'first_action', 'failed']);
});

test('StandardPage requires a task-scoped context lock before invoking the adapter', async () => {
  const fixture = await createExecutionFixture('ane-standard-page');
  let calls = 0;
  const result = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-standard-missing-lock'
  }).execute(
    {
      runId: 'run-standard-missing-lock',
      taskId: 'task-standard-missing-lock',
      stageId: 'requirement-intake',
      subject: {}
    },
    {
      id: 'fake-standard-page-adapter',
      async execute() {
        calls += 1;
        return { status: 'blocked' as const, reason: 'must not run', evidence: [] };
      }
    }
  );

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /XIAONENG_CONTEXT_LOCK_REQUIRED/);
  assert.equal(result.stageTiming?.status, 'failed');
  assert.equal(calls, 0);
});

test('StandardPage managed Codex smoke consumes Xiaoneng context and writes a timing metric', async () => {
  const fixture = await createExecutionFixture('ane-standard-page');
  const prepared = await prepareStandardPageTask(fixture, 'task-standard-managed-smoke');
  const executable = path.join(fixture.tempRoot, 'fake-standard-codex.mjs');
  const auditPath = path.join(fixture.tempRoot, 'standard-codex-audit.json');
  const payload = {
    loadedContext: [
      'repository-skill',
      'project-skill',
      'requirement-brief',
      'dynamic-mounted-repositories',
      'xiaoneng-skill-context',
      'xiaoneng-evidence-selection',
      'xiaoneng-page-contract',
      'xiaoneng-import-rule',
      'previous-memory'
    ],
    contextCharactersUsed: 100,
    toolsUsed: ['read_file', 'git_diff'],
    completedConditions: ['requirement-source-traceable'],
    output: {
      requirementBrief: 'standard page smoke',
      sourceTrace: { type: 'fixture', ref: 'smoke' }
    },
    evidence: [{ checkId: 'requirement-source-traceable', type: 'review', value: 'smoke source trace' }]
  };
  await writeFile(
    executable,
    `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nconst option = (name) => args[args.indexOf(name) + 1];\nlet prompt = '';\nprocess.stdin.setEncoding('utf8');\nfor await (const chunk of process.stdin) prompt += chunk;\nwriteFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, prompt }));\nwriteFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(payload)}));\nprocess.stdout.write(JSON.stringify({ type: 'item.completed' }) + '\\n');\n`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-standard-managed-smoke',
    now: () => new Date('2026-08-10T00:00:00.000Z')
  }).execute(
    {
      runId: 'run-standard-managed-smoke',
      taskId: 'task-standard-managed-smoke',
      stageId: 'requirement-intake',
      subject: { title: 'managed standard page smoke' }
    },
    new CodexCliAdapter({ executable })
  );

  assert.equal(result.status, 'passed', `${result.reasons.join('\\n')}\\n${JSON.stringify(result.harnessResult)}`);
  assert.equal(result.stageTiming?.status, 'passed');
  assert.equal(result.stageTiming?.valid, true);
  assert.equal(result.timingMetric?.status, 'written');
  assert.equal(await pathExists(path.join(fixture.memoryRoot, 'loops', fixture.loop.metadata.id, 'metrics.jsonl')), true);
  const audit = JSON.parse(await readText(auditPath)) as { prompt: string };
  assert.match(audit.prompt, new RegExp(prepared.context.skillContext.contextDigest));
});

test('StandardPage rejects context-lock drift before invoking the adapter', async () => {
  const fixture = await createExecutionFixture('ane-standard-page');
  const prepared = await prepareStandardPageTask(fixture, 'task-standard-lock-drift');
  await writeFile(
    path.join(prepared.root, 'background-context.json'),
    `${JSON.stringify({
      kind: 'BackgroundContextLock',
      version: 1,
      taskId: 'task-standard-lock-drift',
      projectId: prepared.context.projectId,
      backgroundId: prepared.context.backgroundId,
      skillCommit: prepared.context.skillContext.skillCommit,
      contextDigest: 'f'.repeat(64),
      selectedEvidenceBundles: prepared.context.skillContext.evidenceBundles ?? [],
      lockedAt: '2026-08-10T00:00:00.000Z'
    })}\n`,
    'utf8'
  );
  let calls = 0;
  const result = await executeStandardPageStage(fixture, {
    runId: 'run-standard-lock-drift',
    taskId: 'task-standard-lock-drift',
    stageId: 'requirement-intake',
    calls: () => { calls += 1; }
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /XIAONENG_CONTEXT_DIGEST_MISMATCH/);
  assert.equal(calls, 0);
});

test('StandardPage rejects schema and canonical contract digest errors before invoking the adapter', async () => {
  const schemaFixture = await createExecutionFixture('ane-standard-page');
  const schemaPrepared = await prepareStandardPageTask(schemaFixture, 'task-standard-schema');
  await writeFile(path.join(schemaPrepared.root, 'page-contract.json'), '[]\n', 'utf8');
  await markDependencyPassed(schemaFixture, 'run-standard-schema', 'task-standard-schema', 'page-contract-generation');
  let schemaCalls = 0;
  const schemaResult = await executeStandardPageStage(schemaFixture, {
    runId: 'run-standard-schema',
    taskId: 'task-standard-schema',
    stageId: 'page-contract-preflight',
    calls: () => { schemaCalls += 1; }
  });
  assert.equal(schemaResult.status, 'failed');
  assert.match(schemaResult.reasons.join('\n'), /XIAONENG_TASK_ARTIFACT_INVALID/);
  assert.equal(schemaCalls, 0);

  const digestFixture = await createExecutionFixture('ane-standard-page');
  const digestPrepared = await prepareStandardPageTask(digestFixture, 'task-standard-digest');
  const validContract = standardPageContract(digestFixture, digestPrepared.context, 'task-standard-digest');
  await writeFile(
    path.join(digestPrepared.root, 'page-contract.json'),
    `${JSON.stringify({ ...validContract, contractDigest: '0'.repeat(64) })}\n`,
    'utf8'
  );
  await markDependencyPassed(digestFixture, 'run-standard-digest', 'task-standard-digest', 'page-contract-generation');
  let digestCalls = 0;
  const digestResult = await executeStandardPageStage(digestFixture, {
    runId: 'run-standard-digest',
    taskId: 'task-standard-digest',
    stageId: 'page-contract-preflight',
    calls: () => { digestCalls += 1; }
  });
  assert.equal(digestResult.status, 'failed');
  assert.match(digestResult.reasons.join('\n'), /XIAONENG_CONTRACT_DIGEST_MISMATCH/);
  assert.equal(digestCalls, 0);
});

test('StandardPage rejects an import artifact whose source digest is not Xiaoneng evidence', async () => {
  const fixture = await createExecutionFixture('ane-standard-page');
  const prepared = await prepareStandardPageTask(fixture, 'task-standard-import');
  const sourceDocument = prepared.context.documents.find((document) =>
    document.path.endsWith('tmax-standard-import.yaml')
  );
  assert(sourceDocument);
  const invalidDigest = '0'.repeat(64);
  const contract = standardPageContract(fixture, prepared.context, 'task-standard-import', {
    enabled: true,
    ruleRef: 'tmax-standard-import',
    ruleVersion: '1.0.0',
    ruleSource: 'xiaoneng-reference',
    ruleDigest: invalidDigest,
    sourceCommit: prepared.context.skillContext.skillCommit,
    sourceDigest: invalidDigest,
    sourcePath: sourceDocument.path,
    templateRef: 'xlsx-template',
    adapterRef: 'tmax-import-adapter'
  });
  await writeFile(path.join(prepared.root, 'page-contract.json'), `${JSON.stringify(contract)}\n`, 'utf8');
  await writeFile(
    path.join(prepared.root, 'import-rule.json'),
    `${JSON.stringify({
      kind: 'XiaonengImportRule',
      ruleId: 'tmax-standard-import',
      version: '1.0.0',
      pageType: 'StandardPage',
      source: 'xiaoneng-reference',
      adapter: 'tmax-import-adapter',
      ruleDigest: invalidDigest,
      sourceDigest: invalidDigest,
      sourcePath: sourceDocument.path,
      sourceCommit: prepared.context.skillContext.skillCommit
    })}\n`,
    'utf8'
  );
  await markDependencyPassed(fixture, 'run-standard-import', 'task-standard-import', 'frontend-implementation');
  let calls = 0;
  const result = await executeStandardPageStage(fixture, {
    runId: 'run-standard-import',
    taskId: 'task-standard-import',
    stageId: 'import-rule-verification',
    calls: () => { calls += 1; }
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reasons.join('\n'), /IMPORT_RULE_SOURCE_DIGEST_MISMATCH/);
  assert.equal(calls, 0);
});

test('execution runtime fails a stage when Harness rejects a successful adapter result', async () => {
  const fixture = await createExecutionFixture('morning-triage');
  const stage = fixture.plan.workflow?.stages.find((item) => item.id === 'triage-discovery');
  assert(stage);
  const result = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-test-harness',
    now: () => new Date('2026-08-10T00:03:00.000Z')
  }).execute(
    {
      runId: 'run-execution-harness',
      taskId: 'task-execution-harness',
      stageId: 'triage-discovery',
      subject: {}
    },
    {
      id: 'fake-executor',
      async execute() {
        return {
          status: 'completed',
          submission: {
            ...validStageSubmission(
              stage,
              'run-execution-harness',
              'task-execution-harness',
              'generator',
              'coding-harness'
            ),
            completedConditions: ['unexpected-check'],
            evidence: [{ checkId: 'unexpected-check', type: 'review', value: 'wrong check' }]
          },
          evidence: []
        };
      }
    }
  );

  assert.equal(result.status, 'failed');
  assert.equal(result.harnessResult?.status, 'failed');
  assert.match(result.reasons.join('\n'), /Harness rejected/);
  assert.equal(result.stageEvents.at(-1)?.eventType, 'failed');
});

test('execution runtime produces an independent evaluator verdict that can block the stage', async () => {
  const fixture = await createExecutionFixture('morning-triage');
  const stage = fixture.plan.workflow?.stages.find((item) => item.id === 'finding-verification');
  assert(stage);
  const dependencyStore = new StageEventStore(fixture.memoryRoot, fixture.loop.metadata.id);
  const dependency = {
    loopId: fixture.loop.metadata.id,
    runId: 'run-evaluator',
    taskId: 'task-evaluator',
    stageId: 'finding-implementation',
    attempt: 1,
    stageKind: 'coding',
    owner: 'generator'
  };
  await dependencyStore.append(createStageEvent({ ...dependency, eventType: 'entered' }));
  await dependencyStore.append(createStageEvent({ ...dependency, eventType: 'passed' }));

  const approved = await new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-evaluator'
  }).execute(
    {
      runId: 'run-evaluator',
      taskId: 'task-evaluator',
      stageId: stage.id,
      subject: {}
    },
    {
      id: 'fake-independent-evaluator',
      async execute(input) {
        return {
          status: 'completed',
          submission: validStageSubmission(stage, input.runId, input.taskId, 'evaluator', 'coding-harness'),
          evidence: [{ type: 'review', value: 'independent review evidence' }]
        };
      }
    }
  );

  assert.equal(approved.status, 'passed', approved.reasons.join('\n'));
  assert.equal(approved.evaluationVerdict?.decision, 'approved');
  assert.equal(approved.evaluationVerdict?.independent, true);
  assert.deepEqual(approved.executionEvents.slice(-2).map((event) => event.eventType), [
    'harness/verdict',
    'evaluation/verdict'
  ]);
});

test('execution runtime rejects concurrent writers for one run', async () => {
  const fixture = await createExecutionFixture('morning-triage');
  let startedResolve!: () => void;
  const started = new Promise<void>((resolve) => {
    startedResolve = resolve;
  });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  const adapter = {
    id: 'blocking-fake-executor',
    async execute() {
      startedResolve();
      await hold;
      return { status: 'blocked' as const, reason: 'test adapter stopped', evidence: [] };
    }
  };
  const runtime = new ExecutionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    executorInstance: 'executor-test-lock'
  });
  const input = {
    runId: 'run-execution-lock',
    taskId: 'task-execution-lock',
    stageId: 'triage-discovery',
    subject: {}
  };
  const firstPromise = runtime.execute(input, adapter);
  await started;
  const second = await runtime.execute(input, {
    id: 'second-executor',
    async execute() {
      throw new Error('must not be called');
    }
  });
  assert.equal(second.status, 'blocked');
  assert.match(second.reasons.join('\n'), /concurrent_executor/);
  release();
  const first = await firstPromise;
  assert.equal(first.status, 'blocked');
});

test('Codex CLI adapter enforces read-only flags, structured output, and mutation blocking', async () => {
  const fixture = await createExecutionFixture('morning-triage');
  const stage = fixture.plan.workflow?.stages.find((item) => item.id === 'triage-discovery');
  assert(stage);
  const fakeRoot = await mkdtemp(path.join(tmpdir(), 'fake-codex-cli-'));
  const executable = path.join(fakeRoot, 'fake-codex.mjs');
  const auditPath = path.join(fakeRoot, 'audit.json');
  const skillContextFixture = await createSkillContextFixture();
  const backgroundContext = await new SkillContextResolver(skillContextFixture.workspaceRoot).resolve(
    skillContextFixture.plan
  );
  const payload = {
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 4000,
    toolsUsed: ['read_file', 'run_tests', 'git_diff'],
    completedConditions: ['project-skill-review'],
    output: {
      findings: ['No actionable finding in the fixture.']
    },
    evidence: [
      { checkId: 'project-skill-review', type: 'review', value: 'project skill was reviewed' }
    ]
  };
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
if (args[0] !== 'exec') process.exit(21);
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
const schema = JSON.parse(readFileSync(option('--output-schema'), 'utf8'));
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, cwd: process.cwd(), schemaRequired: schema.required, prompt }));
if (args.at(-1) !== '-') process.exit(22);
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(payload)}));
process.stdout.write(JSON.stringify({ type: 'item.completed' }) + '\\n');
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const adapter = new CodexCliAdapter({
    executable,
    now: () => new Date('2026-08-10T00:00:00.000Z')
  });
  const input = {
    loopId: fixture.loop.metadata.id,
    runId: 'run-codex-adapter',
    taskId: 'task-codex-adapter',
    stage,
    attempt: 1,
    actions: [],
    subject: { finding: 'inspect the current failure' },
    workspaceRoot: fixture.workspaceRoot,
    backgroundContext
  };
  const result = await adapter.execute(input);
  assert.equal(result.status, 'completed');
  const submission = result.submission as HarnessRunSubmission;
  assert.equal(submission.runId, input.runId);
  assert.equal(submission.taskId, input.taskId);
  assert.equal(submission.agentId, 'generator');
  assert.equal(submission.harnessId, 'coding-harness');
  assert.equal(submission.loadedContext.includes('xiaoneng-skill-context'), false);
  assert.equal(submission.contextCharactersUsed, payload.contextCharactersUsed + backgroundContext.characters);
  assert.equal(result.evidence.some((item) => item.value.startsWith('engine-background-context:')), true);
  assert.equal(result.evidence.some((item) => item.value.startsWith('engine-background-source-1:')), true);

  const audit = JSON.parse(await readText(auditPath)) as {
    args: string[];
    cwd: string;
    schemaRequired: string[];
    prompt: string;
  };
  assert.equal(audit.args[0], 'exec');
  assert.equal(audit.args[audit.args.indexOf('--cd') + 1], fixture.workspaceRoot);
  assert.equal(audit.args[audit.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(audit.args.includes('--json'), true);
  assert.equal(audit.args.includes('--output-schema'), true);
  assert.equal(audit.args.includes('--output-last-message'), true);
  assert.equal(audit.args.includes('--ephemeral'), true);
  assert.equal(audit.args.includes('--ignore-user-config'), true);
  assert.equal(audit.args.includes('--dangerously-bypass-approvals-and-sandbox'), false);
  assert.equal(audit.args.at(-1), '-');
  assert.deepEqual(audit.schemaRequired, [
    'loadedContext',
    'contextCharactersUsed',
    'toolsUsed',
    'completedConditions',
    'output',
    'evidence'
  ]);
  assert.match(audit.prompt, /engine-background-context-json/);
  assert.match(audit.prompt, /XIAONENG_ENTRY_CONTENT/);
  assert.match(audit.prompt, /OWNER_SKILL_CONTENT/);
  assert.match(audit.prompt, /SELECTED_REFERENCE_CONTENT/);
  assert.match(audit.prompt, /FullWorkflow/);
  assert.match(audit.prompt, new RegExp(backgroundContext.skillContext.contextDigest));
  assert.doesNotMatch(audit.prompt, /MUST_NOT_BE_LOADED|unregistered-link/);
  assert.equal(await pathExists(path.join(fixture.workspaceRoot, 'fake-write.txt')), false);

  const auditBeforeMutation = await readText(auditPath);
  const mutationResult = await adapter.execute({
    ...input,
    stage: { ...stage, id: 'implementation', kind: 'coding' }
  });
  assert.equal(mutationResult.status, 'blocked');
  assert.match(mutationResult.reason ?? '', /unsupported_mutation_stage/);
  assert.equal(await readText(auditPath), auditBeforeMutation);

  const actionResult = await adapter.execute({ ...input, actions: ['merge'] });
  assert.equal(actionResult.status, 'blocked');
  assert.match(actionResult.reason ?? '', /action broker is not configured/);
  assert.equal(await readText(auditPath), auditBeforeMutation);

  const failingExecutable = path.join(fakeRoot, 'failing-codex.mjs');
  await writeFile(
    failingExecutable,
    "#!/usr/bin/env node\nprocess.stderr.write('simulated executor failure\\n');\nprocess.exit(2);\n",
    'utf8'
  );
  await chmod(failingExecutable, 0o755);
  const failedResult = await new CodexCliAdapter({ executable: failingExecutable }).execute({
    ...input,
    subject: { confidentialValue: 'must-not-appear-in-errors' }
  });
  assert.equal(failedResult.status, 'failed');
  assert.match(failedResult.reason ?? '', /exit=2/);
  assert.match(failedResult.reason ?? '', /simulated executor failure/);
  assert.doesNotMatch(failedResult.reason ?? '', /must-not-appear-in-errors/);
});

test('execute CLI routes a read-only stage through the secure runtime with structured output', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-execute-cli-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');
  const subjectPath = path.join(tempRoot, 'subject.json');
  await writeFile(subjectPath, JSON.stringify({ finding: 'inspect the current failure' }), 'utf8');

  const executable = path.join(tempRoot, 'fake-codex.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  const payload = {
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 4000,
    toolsUsed: ['read_file', 'run_tests', 'git_diff'],
    completedConditions: ['project-skill-review'],
    output: {
      findings: ['No actionable finding in the fixture.']
    },
    evidence: [
      { checkId: 'project-skill-review', type: 'review', value: 'project skill was reviewed' }
    ]
  };
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, cwd: process.cwd() }));
if (args.at(-1) !== '-') process.exit(22);
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(payload)}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const executed = await execFileAsync('node', [
    'dist/loop-engineering/cli/loop.js',
    'execute',
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage',
    '--run-id',
    'run-execute-cli',
    '--task-id',
    'task-execute-cli',
    '--stage',
    'triage-discovery',
    '--subject-file',
    subjectPath,
    '--codex-executable',
    executable,
    '--codex-ignore-user-config',
    'false',
    '--codex-output-schema',
    'false',
    '--json'
  ]);
  const result = JSON.parse(executed.stdout) as {
    status: string;
    adapterId: string;
    harnessResult: { status: string } | null;
    stageEvents: Array<{ eventType: string; runId: string; taskId: string; stageId: string }>;
    executionEvents: Array<{ eventType: string; runId: string; taskId: string; stageId: string }>;
  };
  assert.equal(result.status, 'passed');
  assert.equal(result.adapterId, 'codex-cli-read-only');
  assert.equal(result.harnessResult?.status, 'passed');
  assert.deepEqual(result.stageEvents.map((event) => event.eventType), [
    'entered',
    'first_action',
    'waiting_started',
    'waiting_ended',
    'passed'
  ]);
  assert.deepEqual(result.executionEvents.map((event) => event.eventType), [
    'gate/decision',
    'prompt/assembled',
    'model/requested',
    'model/completed',
    'executor/completed',
    'harness/verdict'
  ]);

  const audit = JSON.parse(await readText(auditPath)) as { args: string[]; cwd: string };
  assert.equal(audit.args[audit.args.indexOf('--cd') + 1], tempWorkspace);
  assert.equal(audit.args[audit.args.indexOf('--sandbox') + 1], 'read-only');
  assert.equal(audit.args.includes('--ephemeral'), true);
  assert.equal(audit.args.includes('--ignore-user-config'), false);
  assert.equal(audit.args.includes('--output-schema'), false);
  assert.equal(audit.args.at(-1), '-');

  const persistedEvents = (await readText(
    path.join(tempWorkspace, 'memory', 'loops', 'morning-triage', 'stage-events.jsonl')
  )).trim().split('\n').map((line) => JSON.parse(line) as { runId: string; taskId: string; stageId: string });
  assert.equal(persistedEvents.length, 5);
  assert.equal(persistedEvents.every((event) => event.runId === 'run-execute-cli'), true);
  assert.equal(persistedEvents.every((event) => event.taskId === 'task-execute-cli'), true);
  assert.equal(persistedEvents.every((event) => event.stageId === 'triage-discovery'), true);
  const persistedExecutionEvents = (await readText(
    path.join(
      tempWorkspace,
      'memory',
      'loops',
      'morning-triage',
      'runs',
      'run-execute-cli',
      'execution-events.jsonl'
    )
  )).trim().split('\n').map((line) => JSON.parse(line) as { seq: number; eventType: string });
  assert.deepEqual(persistedExecutionEvents.map((event) => event.seq), [1, 2, 3, 4, 5, 6]);
});

test('gate CLI approves, checks, and revokes an append-only pass', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-gate-cli-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'loop-engineering'), path.join(tempRoot, 'loop-engineering')]);
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  await writeFile(path.join(tempWorkspace, 'workspace.local.yaml'), 'memoryRoot: memory\n', 'utf8');
  const subjectPath = path.join(tempRoot, 'merge-subject.json');
  await writeFile(subjectPath, JSON.stringify(triageMergeSubject), 'utf8');

  const commonArgs = [
    '--workspace',
    tempWorkspace,
    '--loop',
    'morning-triage',
    '--run-id',
    'run-cli-001',
    '--task-id',
    'task-cli-001',
    '--subject-file',
    subjectPath,
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
  assert.equal(plan.orchestrator?.routesTo.project.background?.id, 'xiaoneng');
  assert.deepEqual(plan.backgroundContext, {
    status: 'planned',
    kind: 'skill-context',
    contractVersion: '1.0.0',
    projectId: 't-max',
    backgroundId: 'xiaoneng',
    sourceMount: '.local/t-max/mounts/background/xiaoneng',
    manifestPath: 'harness/runtime/manifest.yaml',
    contractPath: 'harness/contracts/runtime/skill-context.schema.json',
    executionMode: 'FullWorkflow',
    evidenceBundles: [
      'ane-page-rules',
      'standard-page-contract',
      'import-rules',
      'api-binding-rules',
      'reference-pages'
    ],
    validators: ['page-contract', 'page-structure', 'import-rule'],
    maxCharacters: 18000
  });
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
    'coding',
    'merge',
    'release',
    'external-api-contract-change',
    'major-dependency-upgrade',
    'destructive-file-change'
  ]);
  assert.equal(plan.humanGate.gates.length, 6);
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
  assert.equal(
    plan.workflow?.stages.find((stage) => stage.id === 'frontend-design-review')?.harness,
    'frontend-delivery.harness.yaml'
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

test('capability catalog exposes event planes and honest tool enforcement maturity', async () => {
  const catalog = await generateCapabilityCatalog(workspaceRoot);
  assert.equal(catalog.kind, 'CapabilityCatalog');
  assert.equal(catalog.eventPlanes.some((plane) => plane.id === 'execution-facts'), true);
  const triage = catalog.loops.find((loop) => loop.loopId === 'morning-triage');
  assert(triage);
  const evaluation = triage.stages.find((stage) => stage.stageId === 'finding-verification');
  assert(evaluation);
  assert.equal(evaluation.ownerType, 'evaluator');
  assert.equal(evaluation.owner, 'evaluator');
  assert.equal(evaluation.harness, 'coding.harness.yaml');
  assert.equal(evaluation.toolPolicy.enforcement, 'executor-reported-engine-validated');
  assert.equal(evaluation.toolPolicy.allow.includes('run_tests'), true);
  const manualGate = triage.stages.find((stage) => stage.stageId === 'merge-approval');
  assert.equal(manualGate?.toolPolicy.enforcement, 'none');
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
  assert.equal(plan.backgroundContext, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'backgroundContext'), false);
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
  assert.equal(plan.orchestrator?.routesTo.project.resolution.source, 'explicit-repository');
  assert.equal(plan.orchestrator?.routesTo.project.resolution.matchedRepositoryId, 'trunkFeeder-ui');
  assert.equal(plan.handoff.every((handoff) => handoff.project === 'trunkFeeder'), true);
  assert.equal(plan.context.skillPath, 'projects/trunkFeeder/SKILL.md');
  assert.equal(plan.backgroundContext, undefined);
  assert.equal(Object.prototype.hasOwnProperty.call(plan, 'backgroundContext'), false);
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
  assert.match(stdout, /Resolved target: operateBusiness -> t-max -> xiaoneng/);
  assert.match(stdout, /Route source: explicit-repository/);
  assert.match(stdout, /Project route: t-max -> xiaoneng, repositories: 7/);
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

test('simulation writes deterministic artifacts without real stage events', async () => {
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
  assert.equal(result.executionContract.authority, 'simulation_only');
  assert.equal(result.executionContract.adapterInvoked, false);
  assert.equal(result.executionContract.gateChecks, 'not_executed');
  assert.equal(result.executionContract.harnessChecks, 'not_executed');
  assert.equal(result.executionContract.stageEventsWritten, false);
  assert.equal(result.executionContract.workflowStages.length, 6);
  assert.equal(
    result.executionContract.workflowStages.every(
      (stage) =>
        stage.status === 'not_executed' &&
        stage.timing.status === 'unmeasured' &&
        stage.timing.durationMs === null &&
        stage.timing.waitingReason === 'missing_instrumentation'
    ),
    true
  );
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
  assert.match(report, /Execution Contract Preview \/ 执行契约预览/);
  assert.match(report, /Stage events written \/ 已写入节点事件: false/);
  assert.equal(
    await pathExists(path.join(tempWorkspace, 'memory', 'loops', 'morning-triage', 'stage-events.jsonl')),
    false
  );

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
