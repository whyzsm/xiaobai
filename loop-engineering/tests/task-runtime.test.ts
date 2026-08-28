import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { TaskRuntime } from '../packages/task-runtime/src/taskRuntime';
import { GatePassStore, HumanGate } from '../packages/human-gate/src/humanGate';
import { LoopSpec, RuntimePlan } from '../packages/shared/src/types';

const nowValues = [
  '2026-08-15T00:00:00.000Z',
  '2026-08-15T00:01:00.000Z',
  '2026-08-15T00:02:00.000Z',
  '2026-08-15T00:03:00.000Z',
  '2026-08-15T00:04:00.000Z',
  '2026-08-15T00:05:00.000Z'
];

async function createRuntime(loop = loopFixture()) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'task-runtime-'));
  let index = 0;
  const plan = planFixture();
  const runtime = new TaskRuntime({
    workspaceRoot: tempRoot,
    memoryRoot: path.join(tempRoot, 'memory'),
    loop,
    plan,
    now: () => new Date(nowValues[Math.min(index++, nowValues.length - 1)])
  });
  return { tempRoot, runtime, plan };
}

test('task runtime creates prepared task envelopes with route and background metadata', async () => {
  const { runtime, plan } = await createRuntime();

  const task = await runtime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      loopId: 'frontend-delivery',
      subject: { title: 'Change a file' },
      requestedActions: ['write'],
      provider: {
        profileId: 'codex-cli-writable',
        mode: 'managed'
      }
    }
  });

  assert.equal(task.taskId, 'task-1');
  assert.equal(task.state, 'prepared');
  assert.equal(task.projectRoute?.projectId, 't-max');
  assert.equal(task.projectRoute?.resolution.matchedRepositoryId, 'operateBusiness');
  assert.deepEqual(task.projectContext, plan.projectContext);
  assert.deepEqual(task.gateRequirements, ['repo-write']);
  assert.equal(task.events.length, 2);
  assert.equal(task.events.every((event) => event.projectId === 't-max'), true);
  assert.equal(task.events[1].data.backgroundContextDigest !== null, true);
});

test('task runtime fails closed when stored task events lack project identity', async () => {
  const { runtime } = await createRuntime();
  await mkdir(path.dirname(runtime.filePath()), { recursive: true });
  await writeFile(runtime.filePath(), `${JSON.stringify({
    kind: 'TaskEvent',
    version: 1,
    id: 'legacy-event',
    seq: 1,
    taskId: 'task-legacy',
    eventType: 'task/created',
    occurredAt: '2026-08-15T00:00:00.000Z',
    actor: 'runtime',
    state: 'created',
    data: {},
    evidence: []
  })}\n`, 'utf8');

  await assert.rejects(() => runtime.readEvents(), /projectId must be a non-empty string/);
});

test('task runtime rejects invalid transitions and writable run without a lease', async () => {
  const { runtime } = await createRuntime();
  await runtime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      subject: {},
      requestedActions: ['write']
    }
  });

  await assert.rejects(
    () => runtime.transition({
      taskId: 'task-1',
      eventType: 'task/ready_to_merge',
      state: 'ready_to_merge'
    }),
    /Invalid task transition/
  );
  await assert.rejects(
    () => runtime.transition({
      taskId: 'task-1',
      eventType: 'task/running',
      state: 'running'
    }),
    /workspaceLeaseId/
  );
});

test('task runtime projects claimed running and submitted tasks from append-only events', async () => {
  const { tempRoot, runtime } = await createRuntime();
  await runtime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      subject: {},
      requestedActions: ['write']
    }
  });
  await runtime.transition({
    taskId: 'task-1',
    eventType: 'task/leased',
    state: 'leased',
    data: { workspaceLeaseId: 'lease-1' }
  });
  await runtime.transition({
    taskId: 'task-1',
    eventType: 'task/running',
    state: 'running'
  });
  const submitted = await runtime.transition({
    taskId: 'task-1',
    eventType: 'task/submitted',
    state: 'submitted',
    actor: 'entrypoint',
    data: { submission: { summary: 'done' } }
  });

  assert.equal(submitted.state, 'submitted');
  assert.equal(submitted.workspaceLeaseId, 'lease-1');
  assert.equal(submitted.events.length, 5);

  const recovered = new TaskRuntime({
    workspaceRoot: tempRoot,
    memoryRoot: path.join(tempRoot, 'memory'),
    loop: loopFixture(),
    plan: planFixture()
  });
  const listed = await recovered.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].state, 'submitted');
  assert.equal(listed[0].events.length, 5);
});

test('task runtime blocks cancelled tasks from continuing', async () => {
  const { runtime } = await createRuntime();
  await runtime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      subject: {},
      requestedActions: ['read']
    }
  });
  await runtime.transition({
    taskId: 'task-1',
    eventType: 'task/blocked',
    state: 'blocked',
    actor: 'human',
    data: { cancelled: true, reason: 'not needed' }
  });

  await assert.rejects(
    () => runtime.transition({
      taskId: 'task-1',
      eventType: 'task/running',
      state: 'running'
    }),
    /Invalid task transition/
  );
});

test('task runtime runs the shared gate check before appending running', async () => {
  const loop = gatedLoopFixture();
  const { runtime, tempRoot } = await createRuntime(loop);
  await runtime.create({
    taskId: 'task-gated',
    request: {
      entryPoint: 'cli',
      projectId: 't-max',
      runId: 'run-gated',
      subject: { title: 'protected change' },
      requestedActions: ['write']
    }
  });

  await assert.rejects(() => runtime.run({ taskId: 'task-gated' }), /GATE_CHECK_BLOCKED/);
  assert.equal((await runtime.readEvents()).length, 2);

  await runtime.transition({
    taskId: 'task-gated',
    eventType: 'task/leased',
    state: 'leased',
    data: { workspaceLeaseId: 'lease-gated' }
  });
  const gate = new HumanGate(loop);
  const passStore = new GatePassStore(path.join(tempRoot, 'memory'), loop.metadata.id);
  await passStore.append(gate.grant({
    gateId: 'write-approval',
    runId: 'run-gated',
    taskId: 'task-gated',
    issuer: 'loop',
    subject: { title: 'protected change' },
    evidence: [{ type: 'human-approval', value: 'owner approved' }],
    now: new Date('2026-08-15T00:02:00.000Z')
  }));

  const running = await runtime.run({ taskId: 'task-gated' });
  assert.equal(running.state, 'running');
  assert.equal(running.events.at(-1)?.data.gateStatus, 'passed');
});

function loopFixture(): LoopSpec {
  return {
    kind: 'Loop',
    version: 1,
    metadata: {
      id: 'frontend-delivery',
      name: 'Frontend Delivery',
      owner: 'loop'
    },
    schedule: {
      type: 'manual',
      expression: 'manual',
      timezone: 'Asia/Shanghai'
    },
    discovery: {
      skill: 'frontend',
      sources: []
    },
    handoff: {
      strategy: 'worktree',
      project: 't-max',
      worktreeRoot: 'workspace/.local/worktrees',
      branchTemplate: 'loop/{date}/{taskId}'
    },
    generator: {
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml'
    },
    verification: {
      evaluator: 'evaluator.agent.yaml',
      requiredChecks: [],
      allowSelfReview: false
    },
    persistence: {
      memory: {
        stateFile: 'state.md',
        inboxFile: 'inbox.md',
        runLog: 'runs.jsonl'
      },
      outputs: []
    },
    budget: {
      maxTokensPerRun: 1000,
      maxRetriesPerTask: 1,
      maxParallelTasks: 1
    },
    humanGate: {
      requiredBefore: [],
      reviewers: [],
      gates: []
    }
  };
}

function gatedLoopFixture(): LoopSpec {
  const loop = loopFixture();
  loop.humanGate = {
    requiredBefore: ['write'],
    reviewers: ['owner'],
    gates: [{
      id: 'write-approval',
      requiredBefore: 'write',
      reviewers: ['owner'],
      subjectFields: ['title'],
      requiredEvidenceTypes: ['human-approval'],
      maxAgeMinutes: 60
    }]
  };
  return loop;
}

function planFixture(): RuntimePlan {
  const projectContext = {
    projectId: 't-max',
    repositoryRoot: '/workspace/repos/operateBusiness',
    worktreeRoot: '/workspace/worktrees',
    skillPackage: '/workspace/projects/t-max/SKILL.md',
    memoryNamespace: 'project:t-max/loop:frontend-delivery',
    artifactRoot: '/workspace/.loop/artifacts/frontend-delivery/t-max/operateBusiness',
    policyDigest: 'a'.repeat(64)
  };
  const projectRoute = {
    projectContext,
    projectId: 't-max' as const,
    projectKind: 'ProjectGroup' as const,
    projectName: 'T-MAX',
    resolution: {
      source: 'explicit-repository' as const,
      target: 'operateBusiness',
      matchedRepositoryId: 'operateBusiness'
    },
    projectSkillPath: 'projects/t-max/SKILL.md',
    root: '.',
    defaultBranch: 'main',
    background: {
      id: 'xiaoneng',
      name: 'Xiaoneng',
      mount: 'workspace/.local/t-max/mounts/background/xiaoneng'
    },
    repositories: [
      {
        id: 'operateBusiness',
        name: 'operateBusiness',
        mount: 'workspace/.local/t-max/mounts/repositories/operateBusiness'
      }
    ]
  };
  return {
    loopId: 'frontend-delivery',
    projectContext,
    projectRoute,
    loopWorkCount: 0,
    schedule: {
      type: 'manual',
      expression: 'manual',
      timezone: 'Asia/Shanghai',
      nextAction: 'manual'
    },
    budget: {
      ok: true,
      reasons: []
    },
    orchestrator: {
      agentId: 'orchestrator',
      agentFile: 'orchestrator.agent.yaml',
      role: 'orchestrator',
      routesTo: {
        discoverySkill: 'frontend',
        project: projectRoute,
        generatorAgent: 'generator.agent.yaml',
        evaluatorAgent: 'evaluator.agent.yaml',
        workflowStages: []
      }
    },
    context: {
      skillPath: 'projects/t-max/SKILL.md',
      evidenceSources: 0,
      stateFile: 'memory/state.md',
      inboxFile: 'memory/inbox.md',
      maxCharacters: 1000
    },
    findings: [],
    handoff: [],
    generatorRuns: [],
    evaluations: [],
    persistence: {
      stateFile: 'memory/state.md',
      inboxFile: 'memory/inbox.md',
      runLog: 'memory/runs.jsonl',
      plannedWrites: []
    },
    humanGate: {
      protectedActions: ['repo-write'],
      reviewers: ['owner'],
      gates: [
        {
          id: 'repo-write',
          requiredBefore: 'write',
          reviewers: ['owner'],
          subjectFields: ['title'],
          requiredEvidenceTypes: ['human-approval'],
          maxAgeMinutes: 60
        }
      ]
    },
    backgroundContext: {
      status: 'planned',
      kind: 'skill-context',
      contractVersion: '1.0.0',
      projectId: 't-max',
      backgroundId: 'xiaoneng',
      sourceMount: 'workspace/.local/t-max/mounts/background/xiaoneng',
      manifestPath: 'harness/runtime/manifest.yaml',
      contractPath: 'harness/contracts/runtime/skill-context.schema.json',
      executionMode: 'FullWorkflow',
      maxCharacters: 1000
    }
  };
}
