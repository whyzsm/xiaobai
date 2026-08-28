import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { ClientSubmissionRuntime } from '../packages/client-submission-runtime/src/clientSubmissionRuntime';
import { TaskRuntime } from '../packages/task-runtime/src/taskRuntime';
import { LoopSpec, RuntimePlan } from '../packages/shared/src/types';

const execFileAsync = promisify(execFile);

test('client submission reruns harness evaluator diff and policy before ready to merge', async () => {
  const fixture = await createFixture({ dirty: true });
  const taskRuntime = new TaskRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    now: fixedClock()
  });
  await taskRuntime.create({
    taskId: 'task-1',
    request: {
      entryPoint: 'mcp',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      subject: { title: 'client edit' },
      requestedActions: ['write'],
      provider: {
        profileId: 'client-submission',
        mode: 'client'
      }
    }
  });
  await taskRuntime.transition({
    taskId: 'task-1',
    eventType: 'task/leased',
    state: 'leased',
    data: { workspaceLeaseId: 'lease-1' }
  });
  await taskRuntime.transition({
    taskId: 'task-1',
    eventType: 'task/running',
    state: 'running'
  });

  const task = await new ClientSubmissionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    loop: fixture.loop,
    now: () => new Date('2026-08-15T00:09:00.000Z')
  }).submit({
    taskRuntime,
    taskId: 'task-1',
    submission: validSubmission('task-1'),
    worktreePath: fixture.repositoryPath
  });

  assert.equal(task.state, 'ready_to_merge');
  const verification = task.events.at(-1)?.data.clientSubmissionVerification as {
    status: string;
    hostSandbox: string;
    diffCheck: { changedFiles: string[] };
    policyCheck: { status: string };
    harnessResult: { status: string };
    evaluationVerdict: { decision: string };
  };
  assert.equal(verification.status, 'accepted');
  assert.equal(verification.hostSandbox, 'external-untrusted');
  assert.deepEqual(verification.diffCheck.changedFiles, ['README.md']);
  assert.equal(verification.policyCheck.status, 'passed');
  assert.equal(verification.harnessResult.status, 'passed');
  assert.equal(verification.evaluationVerdict.decision, 'approved');
});

test('client submission fails when external success has no inspected diff', async () => {
  const fixture = await createFixture({ dirty: false });
  const taskRuntime = new TaskRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    now: fixedClock()
  });
  await taskRuntime.create({
    taskId: 'task-2',
    request: {
      entryPoint: 'acp',
      projectId: 't-max',
      repositoryId: 'operateBusiness',
      subject: { title: 'claimed edit' },
      requestedActions: ['write'],
      provider: {
        profileId: 'client-submission',
        mode: 'client'
      }
    }
  });
  await taskRuntime.transition({
    taskId: 'task-2',
    eventType: 'task/leased',
    state: 'leased',
    data: { workspaceLeaseId: 'lease-2' }
  });
  await taskRuntime.transition({
    taskId: 'task-2',
    eventType: 'task/running',
    state: 'running'
  });

  const task = await new ClientSubmissionRuntime({
    workspaceRoot: fixture.workspaceRoot,
    loop: fixture.loop,
    now: () => new Date('2026-08-15T00:09:00.000Z')
  }).submit({
    taskRuntime,
    taskId: 'task-2',
    submission: validSubmission('task-2'),
    worktreePath: fixture.repositoryPath
  });

  assert.equal(task.state, 'failed');
  const verification = task.events.at(-1)?.data.clientSubmissionVerification as {
    status: string;
    reasons: string[];
    diffCheck: { status: string };
  };
  assert.equal(verification.status, 'rejected');
  assert.equal(verification.diffCheck.status, 'failed');
  assert(verification.reasons.some((reason) => /no inspected diff/.test(reason)));
});

test('client submission runs the shared gate check before submitted/verifying', async () => {
  const fixture = await createFixture({ dirty: true });
  fixture.loop.humanGate = {
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
  const taskRuntime = new TaskRuntime({
    workspaceRoot: fixture.workspaceRoot,
    memoryRoot: fixture.memoryRoot,
    loop: fixture.loop,
    plan: fixture.plan,
    now: fixedClock()
  });
  await taskRuntime.create({
    taskId: 'task-gated-submit',
    request: {
      entryPoint: 'mcp',
      projectId: 't-max',
      subject: { title: 'protected client edit' },
      requestedActions: ['write'],
      provider: { profileId: 'client-submission', mode: 'client' }
    }
  });
  await taskRuntime.transition({
    taskId: 'task-gated-submit',
    eventType: 'task/leased',
    state: 'leased',
    data: { workspaceLeaseId: 'lease-gated-submit' }
  });
  await taskRuntime.transition({
    taskId: 'task-gated-submit',
    eventType: 'task/running',
    state: 'running'
  });

  await assert.rejects(
    () => new ClientSubmissionRuntime({
      workspaceRoot: fixture.workspaceRoot,
      loop: fixture.loop,
      now: () => new Date('2026-08-15T00:09:00.000Z')
    }).submit({
      taskRuntime,
      taskId: 'task-gated-submit',
      submission: validSubmission('task-gated-submit'),
      worktreePath: fixture.repositoryPath
    }),
    /GATE_CHECK_BLOCKED/
  );
  assert.deepEqual((await taskRuntime.readEvents()).map((event) => event.eventType), [
    'task/created',
    'task/prepared',
    'task/leased',
    'task/running'
  ]);
});

async function createFixture(input: { dirty: boolean }) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'client-submission-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const memoryRoot = path.join(tempRoot, 'memory');
  const repositoryPath = path.join(tempRoot, 'repo');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(repositoryPath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYaml(), 'utf8');
  await execFileAsync('git', ['init', '-q'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'initial'],
    { cwd: repositoryPath }
  );
  if (input.dirty) {
    await writeFile(path.join(repositoryPath, 'README.md'), 'changed by client\n', 'utf8');
  }
  const loop = loopFixture();
  return {
    workspaceRoot,
    memoryRoot,
    repositoryPath,
    loop,
    plan: planFixture(loop)
  };
}

function validSubmission(taskId: string) {
  return {
    runId: 'run-1',
    taskId,
    agentId: 'generator',
    harnessId: 'coding-harness',
    startedAt: '2026-08-15T00:00:00.000Z',
    finishedAt: '2026-08-15T00:05:00.000Z',
    loadedContext: ['repository-skill', 'project-skill', 'task-brief', 'relevant-files', 'previous-memory'],
    contextCharactersUsed: 100,
    toolsUsed: ['read_file', 'write_file', 'run_tests', 'git_diff'],
    completedConditions: ['code_changed', 'tests_attempted', 'summary_written'],
    output: {
      summary: 'changed README',
      changedFiles: ['README.md'],
      testResult: 'fixture smoke only',
      nextRecommendation: 'review diff'
    },
    evidence: [
      { checkId: 'code_changed', type: 'diff', value: 'README.md changed' },
      { checkId: 'tests_attempted', type: 'test', value: 'fixture smoke' },
      { checkId: 'summary_written', type: 'review', value: 'summary present' }
    ]
  };
}

function fixedClock() {
  const values = [
    '2026-08-15T00:00:00.000Z',
    '2026-08-15T00:01:00.000Z',
    '2026-08-15T00:02:00.000Z',
    '2026-08-15T00:03:00.000Z',
    '2026-08-15T00:04:00.000Z',
    '2026-08-15T00:05:00.000Z',
    '2026-08-15T00:06:00.000Z',
    '2026-08-15T00:07:00.000Z',
    '2026-08-15T00:08:00.000Z'
  ];
  let index = 0;
  return () => new Date(values[Math.min(index++, values.length - 1)]);
}

function harnessYaml(): string {
  return `kind: Harness
version: 1
metadata:
  id: coding-harness
tools:
  allow:
    - read_file
    - write_file
    - run_tests
    - git_diff
  deny:
    - direct_merge
    - delete_repository
context:
  loaders:
    - repository-skill
    - project-skill
    - task-brief
    - relevant-files
    - previous-memory
  maxCharacters: 12000
completion:
  type: objective
  conditions:
    - code_changed
    - tests_attempted
    - summary_written
failure: {}
output:
  required:
    - summary
    - changedFiles
    - testResult
    - nextRecommendation
`;
}

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
      worktreeRoot: '.local/frontend-delivery/worktrees',
      branchTemplate: 'loop/frontend-delivery/{date}/{taskId}'
    },
    generator: {
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml'
    },
    verification: {
      evaluator: 'evaluator.agent.yaml',
      requiredChecks: ['lint'],
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
      maxParallelTasks: 2
    },
    humanGate: {
      requiredBefore: [],
      reviewers: [],
      gates: []
    }
  };
}

function planFixture(loop: LoopSpec): RuntimePlan {
  const projectContext = {
    projectId: 't-max',
    repositoryRoot: '/workspace/repos/operateBusiness',
    worktreeRoot: '/workspace/worktrees',
    skillPackage: '/workspace/projects/t-max/SKILL.md',
    memoryNamespace: `project:t-max/loop:${loop.metadata.id}`,
    artifactRoot: `/workspace/.loop/artifacts/${loop.metadata.id}/t-max/operateBusiness`,
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
    repositories: [
      {
        id: 'operateBusiness',
        name: 'operateBusiness',
        mount: 'mounts/operateBusiness'
      }
    ]
  };
  return {
    loopId: loop.metadata.id,
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
      protectedActions: [],
      reviewers: [],
      gates: []
    }
  };
}
