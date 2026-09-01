import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  captureRepositorySnapshot,
  compileContextRequest,
  ContextCompilerError,
  defaultDigestAdapter,
  projectContextEvidence,
  validateContextPack,
  validateContextLock,
} from '../packages/context-compiler/src/contextCompiler';

const commit = '0123456789abcdef0123456789abcdef01234567';
const digest = 'a'.repeat(64);
const now = '2026-09-01T00:00:00.000Z';

function adapterWithCalls() {
  const calls: string[] = [];
  const adapter = defaultDigestAdapter();
  adapter.validate = (kind) => {
    calls.push(kind);
    return { ok: true };
  };
  return { adapter, calls };
}

function snapshot(adapter = defaultDigestAdapter()) {
  return captureRepositorySnapshot({
    projectId: 'project-alpha',
    repositoryId: 'repo-web',
    branch: 'main',
    commit,
    approvedPaths: ['README.md', 'src', 'src'],
    codeFactDigest: digest,
    capturedAt: now,
    classification: 'internal',
  }, adapter);
}

test('captureRepositorySnapshot normalizes paths and delegates contract validation', () => {
  const { adapter, calls } = adapterWithCalls();
  const result = snapshot(adapter);
  assert.deepEqual(result.approvedPaths, ['README.md', 'src']);
  assert.deepEqual(calls, ['RepositorySnapshot']);
  assert.equal(Object.isFrozen(result), true);
});

test('captureRepositorySnapshot rejects absolute and traversal paths', () => {
  assert.throws(
    () => captureRepositorySnapshot({
      projectId: 'project-alpha', repositoryId: 'repo-web', branch: 'main', commit,
      approvedPaths: ['/private/source'], codeFactDigest: digest, capturedAt: now, classification: 'internal'
    }, defaultDigestAdapter()),
    (error) => error instanceof ContextCompilerError && error.code === 'REPOSITORY_PATH_NOT_RELATIVE'
  );
  assert.throws(
    () => captureRepositorySnapshot({
      projectId: 'project-alpha', repositoryId: 'repo-web', branch: 'main', commit,
      approvedPaths: ['src/../secrets'], codeFactDigest: digest, capturedAt: now, classification: 'internal'
    }, defaultDigestAdapter()),
    /REPOSITORY_PATH_NOT_RELATIVE/
  );
});

test('compileContextRequest binds project snapshot and records validation', () => {
  const { adapter, calls } = adapterWithCalls();
  const result = compileContextRequest({
    requestId: 'request-001', taskType: 'frontend.page', userGoal: 'Implement the page',
    project: { projectId: 'project-alpha', displayName: 'Alpha', projectRevision: 'profile-1', classification: 'internal' },
    repository: snapshot(adapter), knowledgeBindings: [{ profileId: 'profile-alpha' }],
    requiredCapabilities: ['frontend.page'],
    authorization: { subjectId: 'agent-xiaobai', allowedProjects: ['project-alpha'], allowedClassifications: ['public', 'internal'] },
    budget: { maxCharacters: 1000, maxItems: 2 },
    selectionPolicy: { strategy: 'ranked', maxItems: 2, includeStale: false },
  }, adapter);
  assert.equal(result.contractVersion, '1.0');
  assert.deepEqual(calls, ['RepositorySnapshot', 'ContextRequest']);
});

test('ContextLock fails closed on missing or drifting tuple', () => {
  const adapter = defaultDigestAdapter();
  const lock = {
    contractVersion: '1.0', contextLockId: 'lock-1', taskId: 'task-1', stage: 'execute' as const,
    projectId: 'project-alpha', repositoryId: 'repo-web', branch: 'main', repositoryCommit: commit,
    contextPackDigest: digest, policyDigest: 'b'.repeat(64), lockedAt: now,
  };
  const current = { ...lock };
  assert.doesNotThrow(() => validateContextLock(lock, current, adapter));
  assert.throws(() => validateContextLock(null, current, adapter), /CONTEXT_LOCK_MISSING/);
  assert.throws(() => validateContextLock(lock, { ...current, repositoryCommit: 'fedcba9876543' }, adapter), /CONTEXT_LOCK_DRIFT/);
});

test('evidence projection keeps context-pack and legacy modes exclusive', () => {
  const adapter = defaultDigestAdapter();
  const lock = {
    contractVersion: '1.0', contextLockId: 'lock-1', taskId: 'task-1', stage: 'execute' as const,
    projectId: 'project-alpha', repositoryId: 'repo-web', branch: 'main', repositoryCommit: commit,
    contextPackDigest: digest, policyDigest: 'b'.repeat(64), lockedAt: now,
  };
  const evidence = projectContextEvidence({ requestId: 'request-1' }, {
    contextDigest: digest,
    knowledgeItems: [{ knowledgeItemId: 'knowledge-1' }],
    omissions: [{ itemId: 'knowledge-2', reason: 'budget' }],
  }, lock, 'context-pack', adapter);
  assert.equal(evidence.selectedKnowledgeItemIds[0], 'knowledge-1');
  assert.throws(() => projectContextEvidence({}, { contextDigest: digest }, lock, 'legacy-background', adapter), /CONTEXT_MODE_CONFLICT/);
});

test('ContextPack validation checks the sealed canonical digest', () => {
  const adapter = defaultDigestAdapter();
  const unsealed = {
    contractVersion: '1.0',
    contextPackId: 'pack-1',
    requestId: 'request-1',
    projectId: 'project-alpha',
    repositoryId: 'repo-web',
    repositoryCommit: commit,
    knowledgeItems: [],
    sources: [],
    conflicts: [],
    omissions: [],
    budget: { maxCharacters: 1000, maxItems: 2, usedCharacters: 0, usedItems: 0 },
    generatedAt: now,
  };
  const pack = { ...unsealed, contextDigest: adapter.digest(unsealed) };
  assert.doesNotThrow(() => validateContextPack(pack, adapter));
  assert.throws(
    () => validateContextPack({ ...pack, omissions: [{ itemId: 'item-1', reason: 'budget' }] }, adapter),
    /CONTEXT_PACK_DIGEST_MISMATCH/
  );
});
