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
  validateExecutionContract,
  validateImaRetrievalEvidence,
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
        projectId: 't-max',
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
        projectId: 't-max',
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

  const crossProjectEvent = {
    ...envelope,
    events: envelope.events.map((event, index) => index === 1 ? { ...event, projectId: 'another-project' } : event)
  };
  assert.match(validateTaskEnvelope(crossProjectEvent).join('\n'), /projectId must match envelope projectId/);
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

test('frontend execution contracts require scoped authorization and repository baseline locks', () => {
  const authorization = {
    kind: 'AuthorizationLock',
    version: 1,
    taskId: 'task-page',
    projectId: 't-max-dcm',
    repositoryId: 'dcm',
    actions: ['write'],
    scope: 'src/pages/orders',
    grantedBy: 'owner',
    grantedAt: now,
    expiresAt: later,
    digest: `sha256:${'b'.repeat(64)}`
  };
  const baseline = {
    kind: 'RepositoryBaselineLock',
    version: 1,
    taskId: 'task-page',
    projectId: 't-max-dcm',
    repositoryId: 'dcm',
    repositoryRoot: '/mounted/dcm',
    worktreePath: '/mounted/dcm',
    branch: 'dsh-9829liu',
    baseRef: 'master',
    headSha: 'a'.repeat(40),
    dirtyFiles: [],
    capturedAt: now,
    digest: `sha256:${'c'.repeat(64)}`
  };
  const contract = {
    kind: 'PageExecutionContract',
    version: 1,
    mode: 'existing-page',
    taskId: 'task-page',
    projectId: 't-max-dcm',
    repositoryId: 'dcm',
    targetPageRoot: 'src/pages/orders',
    contextDigest: 'd'.repeat(64),
    contractDigest: 'e'.repeat(64),
    authorization,
    baseline,
    changedFiles: ['src/pages/orders/index.tsx'],
    evidence: [{ type: 'file', value: 'baseline captured' }]
  };
  assert.deepEqual(validateExecutionContract(contract), []);
  assert.deepEqual(validateExecutionContract({ ...contract, authorization: { ...authorization, projectId: 'other' } }).filter((error) => /must match/.test(error)).length, 1);
  assert.match(validateExecutionContract({ ...contract, authorization: undefined }).join('\n'), /authorization/);
  assert.match(
    validateExecutionContract(contract, 'executionContract', new Date('2026-08-15T00:11:00.000Z')).join('\n'),
    /expiresAt must be later than the current time/
  );
});

test('API integration contracts require endpoint runtime evidence or explicit blockers', () => {
  const common = {
    kind: 'ApiExecutionContract',
    version: 1,
    mode: 'ApiIntegration',
    taskId: 'task-api',
    projectId: 't-max-dcm',
    repositoryId: 'dcm',
    contextDigest: 'a'.repeat(64),
    contractDigest: 'b'.repeat(64),
    authorization: {
      kind: 'AuthorizationLock', version: 1, taskId: 'task-api', projectId: 't-max-dcm', repositoryId: 'dcm',
      actions: ['write'], scope: 'src/services', grantedBy: 'owner', grantedAt: now, expiresAt: later, digest: `sha256:${'c'.repeat(64)}`
    },
    baseline: {
      kind: 'RepositoryBaselineLock', version: 1, taskId: 'task-api', projectId: 't-max-dcm', repositoryId: 'dcm',
      repositoryRoot: '/mounted/dcm', worktreePath: '/mounted/dcm', branch: 'dsh-9829liu', baseRef: 'master',
      headSha: 'd'.repeat(40), dirtyFiles: [], capturedAt: now, digest: `sha256:${'e'.repeat(64)}`
    },
    evidence: []
  };
  const verified = {
    ...common,
    endpoints: [{
      endpointId: 'orders-list', method: 'GET', path: '/api/orders', status: 'runtime_verified',
      contractSource: 'openapi/orders.yaml', contractDigest: 'f'.repeat(64), codePath: 'src/services/orders.ts',
      sourceDigest: '1'.repeat(64), runtimeEvidence: [{ type: 'test', value: 'GET /api/orders 200' }]
    }]
  };
  assert.deepEqual(validateExecutionContract(verified), []);
  const blocked = {
    ...common,
    endpoints: [{
      endpointId: 'orders-list', method: 'GET', path: '/api/orders', status: 'runtime_blocked',
      contractSource: 'openapi/orders.yaml', contractDigest: 'f'.repeat(64), blocker: 'authentication', reason: 'token unavailable'
    }]
  };
  assert.deepEqual(validateExecutionContract(blocked), []);
  assert.match(validateExecutionContract({ ...verified, endpoints: [{ ...verified.endpoints[0], runtimeEvidence: [] }] }).join('\n'), /runtimeEvidence/);
  assert.match(
    validateExecutionContract({
      ...verified,
      endpoints: [{ ...verified.endpoints[0], codePath: undefined, sourceDigest: undefined }]
    }).join('\n'),
    /codePath|sourceDigest/
  );
});

test('IMA retrieval evidence requires aligned selected IDs and metadata', () => {
  const valid = {
    query: 'page contract', queryHash: `sha256:${'a'.repeat(64)}`, selectedItemIds: ['note-1'],
    retrievedAt: now, source: ['ima://note-1'], revision: ['r1'], digest: [`sha256:${'b'.repeat(64)}`],
    scope: 't-max-dcm', adapterVersion: 'ima-adapter-v1', status: 'success'
  };
  assert.deepEqual(validateImaRetrievalEvidence(valid), []);
  assert.match(validateImaRetrievalEvidence({ ...valid, revision: [] }).join('\n'), /metadata arrays/);
  assert.match(validateImaRetrievalEvidence({ ...valid, digest: ['not-a-digest'] }).join('\n'), /digest must be an array of digests/);
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
