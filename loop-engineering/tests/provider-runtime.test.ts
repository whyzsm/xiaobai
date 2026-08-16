import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { PromptRuntime } from '../packages/prompt-runtime/src/promptRuntime';
import {
  claudeManagedProfileId,
  clientSubmissionProfileId,
  codexReadOnlyProfileId,
  codexWritableProfileId,
  geminiManagedProfileId,
  normalizeProviderRuntimeEvent,
  parseProviderRunResult,
  ProviderRuntime,
  validateProviderCanHandle,
  validateProviderWorkspaceGuard,
  workbuddyClientProfileId,
  zcodeClientProfileId
} from '../packages/provider-runtime/src/providerRuntime';
import { CodexCliAdapter } from '../packages/execution-runtime/src/codexCliAdapter';
import {
  ExecutorAdapter,
  ExecutorAdapterInput,
  ExecutorAdapterResult,
  HarnessSpec,
  ResolvedBackgroundContext,
  TaskEnvelope,
  WorkspaceLease,
  WorkflowStagePlan
} from '../packages/shared/src/types';

test('prompt runtime assembles deterministic provider-neutral payloads with background metadata', () => {
  const runtime = new PromptRuntime();
  const first = runtime.assemble({
    task: taskFixture({ subject: { title: 'A' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });
  const second = runtime.assemble({
    task: taskFixture({ subject: { title: 'A' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });
  const changed = runtime.assemble({
    task: taskFixture({ subject: { title: 'B' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });

  assert.equal(first.promptDigest, second.promptDigest);
  assert.notEqual(first.promptDigest, changed.promptDigest);
  assert.match(first.prompt, /xiaobai-provider-prompt-v1/);
  assert.equal(
    (first.payload.backgroundContext as { contextDigest: string }).contextDigest,
    'b'.repeat(64)
  );
});

test('provider runtime selects default read-only Codex profile and blocks writable actions', () => {
  const runtime = new ProviderRuntime();
  const profile = runtime.selectProfile({ requestedActions: ['read'] });

  assert.equal(profile.id, codexReadOnlyProfileId);
  assert.equal(profile.writable, false);
  assert.deepEqual(validateProviderCanHandle(profile, ['read']), []);
  assert.match(validateProviderCanHandle(profile, ['write']).join('\n'), /read-only/);
  assert.throws(() => runtime.selectProfile({ requestedActions: ['write'] }), /capability mismatch/);
});

test('provider runtime exposes writable Codex profile and validates lease scoped cwd', () => {
  const runtime = new ProviderRuntime();
  const profile = runtime.requireProfile(codexWritableProfileId);
  const lease = leaseFixture();

  assert.equal(profile.writable, true);
  assert.deepEqual(validateProviderCanHandle(profile, ['write']), []);
  assert.deepEqual(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      workspaceLease: lease,
      cwd: '/tmp/worktrees/task-1/src'
    }),
    []
  );
  assert.match(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      cwd: '/tmp/worktrees/task-1'
    }).join('\n'),
    /workspace lease/
  );
  assert.match(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      workspaceLease: lease,
      cwd: '/tmp/other'
    }).join('\n'),
    /lease path/
  );
});

test('provider registry records support levels without over-claiming external tools', () => {
  const runtime = new ProviderRuntime();
  const support = new Map(runtime.listProfiles().map((profile) => [profile.id, profile.supportLevel]));

  assert.equal(support.get(codexReadOnlyProfileId), 'supported');
  assert.equal(support.get(codexWritableProfileId), 'experimental');
  assert.equal(support.get(claudeManagedProfileId), 'experimental');
  assert.equal(support.get(geminiManagedProfileId), 'experimental');
  assert.equal(support.get(clientSubmissionProfileId), 'client_only');
  assert.equal(support.get(zcodeClientProfileId), 'client_only');
  assert.equal(support.get(workbuddyClientProfileId), 'client_only');
});

test('provider runtime creates adapters through registered factories', () => {
  const runtime = new ProviderRuntime();
  const selected = runtime.createExecutorAdapter({
    requestedActions: ['read'],
    factories: {
      [codexReadOnlyProfileId]: () => new DummyAdapter()
    }
  });

  assert.equal(selected.profile.id, codexReadOnlyProfileId);
  assert.equal(selected.adapter.id, 'dummy');
});

test('provider runtime normalizes provider events into executor reported events', () => {
  const event = normalizeProviderRuntimeEvent({
    eventType: 'model/requested',
    providerProfileId: codexReadOnlyProfileId,
    taskId: 'task-1',
    data: { requestId: 'run:task:stage:1' },
    evidence: [{ type: 'command', value: 'codex exec' }]
  });

  assert.equal(event.eventType, 'model/requested');
  assert.equal(event.data.providerProfileId, codexReadOnlyProfileId);
  assert.equal(event.data.taskId, 'task-1');
  assert.equal(event.data.requestId, 'run:task:stage:1');
  assert.equal(event.evidence?.[0].type, 'command');
});

test('provider runtime parses provider run result change summaries', () => {
  const result = parseProviderRunResult({
    taskId: 'task-1',
    providerProfileId: codexWritableProfileId,
    status: 'completed',
    startedAt: '2026-08-15T00:00:00.000Z',
    finishedAt: '2026-08-15T00:01:00.000Z',
    output: {
      changedFiles: ['src/example.ts'],
      diffSummary: 'updated example',
      verificationCommands: ['npm run build']
    },
    evidence: [{ type: 'diff', value: 'src/example.ts changed' }]
  });

  assert.deepEqual(result.changedFiles, ['src/example.ts']);
  assert.equal(result.diffSummary, 'updated example');
  assert.deepEqual(result.verificationCommands, ['npm run build']);
});

test('writable Codex adapter blocks before process launch without an explicit worktree path', async () => {
  const adapter = new CodexCliAdapter({ sandbox: 'workspace-write', executable: 'definitely-not-called' });
  const result = await adapter.execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: {
      id: 'implementation',
      kind: 'coding',
      status: 'planned',
      gate: 'automatic',
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml',
      dependsOn: [],
      requiredChecks: [],
      requiredGates: [],
      requiredBefore: [],
      outputs: []
    },
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot: process.cwd()
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason ?? '', /missing_workspace_lease/);
});

test('Codex adapter reports JSONL turn failures when no last message is produced', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-jsonl-failure-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.js');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'turn.failed',
  error: { message: 'unexpected status 401 Unauthorized: Incorrect API key provided: sk-1234567890abcdef' }
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({ sandbox: 'workspace-write', executable }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: {
      id: 'implementation',
      kind: 'coding',
      status: 'planned',
      gate: 'automatic',
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml',
      dependsOn: [],
      requiredChecks: [],
      requiredGates: [],
      requiredBefore: [],
      outputs: []
    },
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /codex_cli_failed/);
  assert.match(result.reason ?? '', /sk-<redacted>/);
});

class DummyAdapter implements ExecutorAdapter {
  readonly id = 'dummy';

  async execute(_input: ExecutorAdapterInput): Promise<ExecutorAdapterResult> {
    return {
      status: 'completed',
      submission: {},
      evidence: []
    };
  }
}

function taskFixture(input: { subject: Record<string, unknown> }): TaskEnvelope {
  return {
    kind: 'TaskEnvelope',
    version: 1,
    taskId: 'task-1',
    state: 'prepared',
    entryPoint: 'cli',
    projectId: 't-max',
    subject: input.subject,
    requestedActions: ['read'],
    providerMode: 'managed',
    gateRequirements: [],
    events: [
      {
        kind: 'TaskEvent',
        version: 1,
        id: 'event-1',
        seq: 1,
        taskId: 'task-1',
        eventType: 'task/created',
        occurredAt: '2026-08-15T00:00:00.000Z',
        actor: 'runtime',
        state: 'created',
        data: {},
        evidence: []
      }
    ],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  };
}

function stageFixture(): WorkflowStagePlan {
  return {
    id: 'review',
    kind: 'review',
    status: 'planned',
    gate: 'automatic',
    evaluator: 'checker.agent.yaml',
    dependsOn: [],
    requiredChecks: ['reviewed'],
    requiredGates: [],
    requiredBefore: [],
    outputs: ['summary']
  };
}

function harnessFixture(): HarnessSpec {
  return {
    kind: 'Harness',
    version: 1,
    metadata: {
      id: 'review-harness'
    },
    tools: {
      allow: ['read_file'],
      deny: ['write_file']
    },
    context: {
      loaders: ['task'],
      maxCharacters: 1000
    },
    completion: {
      type: 'all',
      conditions: ['reviewed']
    },
    failure: {},
    output: {
      required: ['summary']
    }
  };
}

function harnessYamlFixture(): string {
  return `kind: Harness
version: 1
metadata:
  id: coding-harness
tools:
  allow:
    - read_file
  deny: []
context:
  loaders: []
  maxCharacters: 1000
completion:
  type: objective
  conditions: []
failure: {}
output:
  required: []
`;
}

function backgroundFixture(): ResolvedBackgroundContext {
  return {
    kind: 'skill-context',
    projectId: 't-max',
    backgroundId: 'xiaoneng',
    skillContext: {
      contractVersion: '1.0.0',
      skillId: 'xiaoneng-agent',
      skillCommit: 'a'.repeat(40),
      entryPath: 'xiaoneng-agent/SKILL.md',
      entryHash: 'a'.repeat(64),
      manifestPath: 'harness/runtime/manifest.yaml',
      manifestDigest: 'a'.repeat(64),
      executionMode: 'FullWorkflow',
      ownerAgent: 'xiaoneng-agent',
      ownerSkills: ['op-ship-ops'],
      selectedReferences: [],
      contextDigest: 'b'.repeat(64)
    },
    documents: [
      {
        roles: ['entry'],
        path: 'xiaoneng-agent/SKILL.md',
        sourceDigest: 'c'.repeat(64),
        contentDigest: 'd'.repeat(64),
        selection: 'full',
        content: 'background'
      }
    ],
    characters: 10
  };
}

function leaseFixture(): WorkspaceLease {
  return {
    kind: 'WorkspaceLease',
    version: 1,
    leaseId: 'lease-1',
    taskId: 'task-1',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    repositoryPath: '/tmp/repo',
    baseRef: 'main',
    branch: 'loop/task-1',
    path: '/tmp/worktrees/task-1',
    state: 'active',
    owner: {
      id: 'codex',
      role: 'writer',
      providerProfileId: codexWritableProfileId,
      claimedAt: '2026-08-15T00:00:00.000Z'
    },
    heartbeat: {
      intervalMs: 60000,
      lastSeenAt: '2026-08-15T00:00:00.000Z',
      expiresAt: '2026-08-15T00:02:00.000Z'
    },
    dirtyPolicy: 'retain_dirty',
    evidence: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  };
}
