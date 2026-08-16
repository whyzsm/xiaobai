import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  assertValidProviderProfile,
  assertValidPromotionPlan,
  assertValidTaskEnvelope,
  assertValidWorkspaceLease,
  validateProviderProfile,
  validateProviderRunRequest,
  validateProviderRunResult,
  validatePromotionPlan,
  validateTaskEnvelope,
  validateTaskRequest,
  validateWorkspaceLease
} from '../packages/shared/src/portableExecutionContracts';
import {
  PromotionPlan,
  ProviderProfile,
  TaskEnvelope,
  TaskRequest,
  WorkspaceLease
} from '../packages/shared/src/types';

const now = '2026-08-15T00:00:00.000Z';
const later = '2026-08-15T00:10:00.000Z';
const digest = 'a'.repeat(64);

test('portable task contracts accept a valid request and envelope', () => {
  const request: TaskRequest = {
    entryPoint: 'cli',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    subject: { title: 'Update one file' },
    requestedActions: ['write'],
    provider: {
      profileId: 'codex-cli-writable',
      mode: 'managed'
    }
  };

  assert.deepEqual(validateTaskRequest(request), []);

  const envelope: TaskEnvelope = {
    kind: 'TaskEnvelope',
    version: 1,
    taskId: 'task-1',
    state: 'leased',
    entryPoint: 'cli',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    subject: request.subject,
    requestedActions: request.requestedActions,
    providerMode: 'managed',
    providerProfileId: 'codex-cli-writable',
    workspaceLeaseId: 'lease-1',
    gateRequirements: ['repo-write'],
    promptDigest: digest,
    events: [
      {
        kind: 'TaskEvent',
        version: 1,
        id: 'event-1',
        seq: 1,
        taskId: 'task-1',
        eventType: 'task/created',
        occurredAt: now,
        actor: 'runtime',
        state: 'created',
        data: {},
        evidence: []
      },
      {
        kind: 'TaskEvent',
        version: 1,
        id: 'event-2',
        seq: 2,
        taskId: 'task-1',
        eventType: 'task/leased',
        occurredAt: later,
        actor: 'runtime',
        state: 'leased',
        data: { leaseId: 'lease-1' },
        evidence: [{ type: 'command', value: 'git worktree add <path> <branch>' }]
      }
    ],
    createdAt: now,
    updatedAt: later
  };

  assert.deepEqual(validateTaskEnvelope(envelope), []);
  assert.doesNotThrow(() => assertValidTaskEnvelope(envelope));
});

test('portable task contracts reject invalid states and missing writable lease references', () => {
  const invalidState = {
    kind: 'TaskEnvelope',
    version: 1,
    taskId: 'task-1',
    state: 'done',
    entryPoint: 'cli',
    projectId: 't-max',
    subject: {},
    requestedActions: ['write'],
    providerMode: 'managed',
    gateRequirements: [],
    events: [],
    createdAt: now,
    updatedAt: now
  };

  assert.match(validateTaskEnvelope(invalidState).join('\n'), /state/);

  const missingLease = {
    ...invalidState,
    state: 'running'
  };

  assert.match(validateTaskEnvelope(missingLease).join('\n'), /workspaceLeaseId/);
});

test('portable lease contracts enforce owner, heartbeat, and dirty retention rules', () => {
  const lease: WorkspaceLease = {
    kind: 'WorkspaceLease',
    version: 1,
    leaseId: 'lease-1',
    taskId: 'task-1',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    repositoryPath: '/tmp/repo',
    baseRef: 'main',
    branch: 'loop/2026-08-15/task-1',
    path: '/tmp/repo-worktrees/task-1',
    state: 'active',
    owner: {
      id: 'writer-1',
      role: 'writer',
      providerProfileId: 'codex-cli-writable',
      claimedAt: now
    },
    heartbeat: {
      intervalMs: 30000,
      lastSeenAt: now,
      expiresAt: later
    },
    dirtyPolicy: 'retain_dirty',
    evidence: [{ type: 'command', value: 'git worktree add /tmp/repo-worktrees/task-1 loop/2026-08-15/task-1' }],
    createdAt: now,
    updatedAt: later
  };

  assert.deepEqual(validateWorkspaceLease(lease), []);
  assert.doesNotThrow(() => assertValidWorkspaceLease(lease));

  const readerOwnedActive = {
    ...lease,
    owner: {
      id: 'reader-1',
      role: 'reader',
      claimedAt: now
    }
  };

  assert.match(validateWorkspaceLease(readerOwnedActive).join('\n'), /writer owner/);

  const dirtyDelete = {
    ...lease,
    state: 'dirty_retained',
    dirtyPolicy: 'delete_when_clean'
  };

  assert.match(validateWorkspaceLease(dirtyDelete).join('\n'), /retain_dirty/);
});

test('provider contracts reject capability and support-level mismatches', () => {
  const profile: ProviderProfile = {
    kind: 'ProviderProfile',
    version: 1,
    id: 'codex-cli-writable',
    displayName: 'Codex CLI Writable',
    mode: 'managed',
    transport: 'cli',
    supportLevel: 'experimental',
    executable: 'codex',
    supportedActions: ['read', 'write'],
    writable: true,
    sandbox: {
      profile: 'workspace-write',
      assumptions: ['host sandbox is controlled by Codex CLI']
    },
    timeoutMs: 900000,
    requiredVerification: ['harness', 'evaluator', 'diff']
  };

  assert.deepEqual(validateProviderProfile(profile), []);
  assert.doesNotThrow(() => assertValidProviderProfile(profile));

  assert.match(
    validateProviderProfile({
      ...profile,
      sandbox: { profile: 'read-only', assumptions: ['read only'] }
    }).join('\n'),
    /read-only/
  );

  assert.match(
    validateProviderProfile({
      ...profile,
      supportLevel: 'client_only'
    }).join('\n'),
    /client_only/
  );
});

test('provider run contracts require prompt digests and failure reasons', () => {
  assert.deepEqual(
    validateProviderRunRequest({
      taskId: 'task-1',
      providerProfileId: 'codex-cli-writable',
      mode: 'managed',
      prompt: 'Do the task.',
      promptDigest: digest,
      requestedActions: ['write']
    }),
    []
  );

  assert.match(
    validateProviderRunRequest({
      taskId: 'task-1',
      providerProfileId: 'codex-cli-writable',
      mode: 'managed',
      prompt: 'Do the task.',
      promptDigest: 'bad',
      requestedActions: ['write']
    }).join('\n'),
    /sha256/
  );

  assert.match(
    validateProviderRunResult({
      taskId: 'task-1',
      providerProfileId: 'codex-cli-writable',
      status: 'failed',
      startedAt: now,
      finishedAt: later,
      changedFiles: [],
      verificationCommands: [],
      output: {},
      evidence: []
    }).join('\n'),
    /reason/
  );
});

test('promotion contracts block ready plans that still contain conflicts', () => {
  const plan: PromotionPlan = {
    kind: 'PromotionPlan',
    version: 1,
    promotionId: 'promotion-1',
    taskId: 'task-1',
    sourceBranch: 'loop/2026-08-15/task-1',
    targetBranch: 'main',
    state: 'queued',
    requiredGates: ['push-branch'],
    brokerDecisions: [
      {
        action: 'push',
        status: 'authorized',
        reasons: ['gate passed'],
        evidence: [{ type: 'human-approval', value: 'push approved' }],
        decidedAt: now
      }
    ],
    conflicts: [],
    evidence: [{ type: 'diff', value: 'diff inspected' }],
    createdAt: now,
    updatedAt: later
  };

  assert.deepEqual(validatePromotionPlan(plan), []);
  assert.doesNotThrow(() => assertValidPromotionPlan(plan));

  assert.match(
    validatePromotionPlan({
      ...plan,
      state: 'ready',
      conflicts: [
        {
          file: 'src/example.ts',
          reason: 'same line changed',
          evidence: [{ type: 'diff', value: 'conflict marker' }]
        }
      ]
    }).join('\n'),
    /conflicts/
  );
});
