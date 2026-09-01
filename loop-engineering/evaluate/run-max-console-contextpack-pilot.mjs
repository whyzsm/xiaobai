import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(process.env.MAX_CONSOLE_REPO_ROOT || '');
const xiaonengRoot = path.resolve(process.env.XIAONENG_ROOT || '');
const contractsRoot = path.resolve(process.env.DEV_CONTEXT_CONTRACTS_PATH || '');
const distRoot = path.resolve(process.env.XBAI_DIST_ROOT || '');

for (const [name, value] of Object.entries({ repositoryRoot, xiaonengRoot, contractsRoot, distRoot })) {
  if (!value || value === path.resolve('.')) throw new Error(`${name} environment variable is required`);
}

const compilerPath = path.join(distRoot, 'loop-engineering/packages/context-compiler/src/contextCompiler.js');
if (!fs.existsSync(compilerPath)) throw new Error(`compiled context compiler is missing: ${compilerPath}`);
const compiler = createRequire(import.meta.url)(compilerPath);
const contracts = await import(pathToFileURL(path.join(contractsRoot, 'src/index.mjs')).href);
const resolver = await import(pathToFileURL(path.join(xiaonengRoot, 'harness/runtime/context-pack-resolver.mjs')).href);

function git(...args) {
  return execFileSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' }).trim();
}

function gitAt(root, ...args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const adapter = {
  contractVersion: '1.0',
  validate: (kind, payload) => contracts.validateContract(kind, payload),
  digest: (payload) => contracts.sha256Canonical(payload),
};
const resolverAdapter = {
  validateRequest: (payload) => contracts.validateContract('ContextRequest', payload),
  validatePack: (payload) => contracts.validateContract('ContextPack', payload),
  digest: (payload) => contracts.sha256Canonical(payload),
};

const before = {
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git('rev-parse', 'HEAD'),
  status: git('status', '--porcelain=v1'),
};
const approvedPaths = ['README.md', 'config', 'package.json', 'src'];
const tree = git('ls-tree', '-r', '--full-tree', 'HEAD', '--', ...approvedPaths);
const codeFactDigest = contracts.sha256Canonical({ approvedPaths, commit: before.commit, tree });
const capturedAt = new Date().toISOString();

const snapshotInput = {
  projectId: 'tmax-max-console-ui',
  repositoryId: 'max-console-ui',
  branch: before.branch,
  commit: before.commit,
  approvedPaths,
  codeFactDigest,
  capturedAt,
  classification: 'internal',
  sourceRevision: before.commit,
};
const snapshot = compiler.captureRepositorySnapshot(snapshotInput, adapter);
const repeatedSnapshot = compiler.captureRepositorySnapshot(clone(snapshotInput), adapter);
assert.deepEqual(repeatedSnapshot, snapshot);

const xiaonengCommit = gitAt(xiaonengRoot, 'rev-parse', 'HEAD');
const principles = fs.readFileSync(path.join(xiaonengRoot, 'xiaoneng-principles.md'), 'utf8');
const evidenceRule = principles
  .split('\n')
  .find((line) => line.includes('可复现证据优先于口头保证'))
  ?.replace(/^\s*-\s*/, '')
  .trim();
if (!evidenceRule) throw new Error('could not resolve the provenance-bearing Xiaoneng rule');
const evidenceRuleDigest = contracts.sha256Text(evidenceRule);
const staleContent = 'Repository code facts are bound to a concrete commit.';
const staleContentDigest = contracts.sha256Text(staleContent);
const privateContent = 'Private project guidance must stay inside its owning project.';
const privateContentDigest = contracts.sha256Text(privateContent);

const requestInput = {
  requestId: 'max-console-context-pilot-001',
  taskType: 'code.explain',
  userGoal: 'Read-only pilot for max-console-ui repository context binding and architecture knowledge resolution.',
  project: {
    projectId: 'tmax-max-console-ui',
    displayName: 'max-console-ui',
    projectRevision: 'project-config-1',
    classification: 'internal',
    owner: 'team-tmax',
  },
  repository: snapshot,
  knowledgeBindings: [{
    knowledgeSpaceId: 'space-tmax-shared',
    profileId: 'profile-tmax-readonly',
    scope: 'global',
    allowedProjects: ['*'],
    classification: 'public',
    owner: 'team-xiaoneng',
    revision: xiaonengCommit,
    requiredCapabilities: ['code.explain'],
  }],
  requiredCapabilities: ['code.explain'],
  authorization: {
    subjectId: 'agent-xiaobai',
    allowedProjects: ['tmax-max-console-ui'],
    allowedClassifications: ['public', 'internal'],
  },
  budget: { maxCharacters: 8000, maxItems: 3 },
  selectionPolicy: { strategy: 'ranked', maxItems: 3, includeStale: false },
};
const request = compiler.compileContextRequest(requestInput, adapter);
const repeatedRequest = compiler.compileContextRequest(clone(requestInput), adapter);
assert.equal(adapter.digest(repeatedRequest), adapter.digest(request));

const knowledgeItems = [
  {
    knowledgeItemId: 'xiaoneng-evidence-rule',
    scope: 'global',
    classification: 'public',
    owner: 'team-xiaoneng',
    revision: xiaonengCommit,
    contentDigest: evidenceRuleDigest,
    source: { sourceId: 'xiaoneng-principles', revision: xiaonengCommit, contentDigest: evidenceRuleDigest },
    content: evidenceRule,
  },
  {
    knowledgeItemId: 'other-project-private-rule',
    scope: 'project',
    projectId: 'another-tmax-project',
    classification: 'internal',
    owner: 'team-other-project',
    revision: 'private-profile-1',
    contentDigest: privateContentDigest,
    source: { sourceId: 'other-project-profile', revision: 'private-profile-1', contentDigest: privateContentDigest },
    content: privateContent,
  },
  {
    knowledgeItemId: 'stale-console-code-fact',
    scope: 'repository',
    projectId: 'tmax-max-console-ui',
    repositoryId: 'max-console-ui',
    repositoryCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    classification: 'internal',
    owner: 'team-tmax',
    revision: 'code-fact-old',
    contentDigest: staleContentDigest,
    source: { sourceId: 'console-code-facts', revision: 'code-fact-old', contentDigest: staleContentDigest },
    content: staleContent,
  },
];
const pack = resolver.resolveContextPack({
  request,
  knowledgeItems,
  adapter: resolverAdapter,
  now: capturedAt,
});
compiler.validateContextPack(pack, adapter);
assert.deepEqual(pack.knowledgeItems.map(({ knowledgeItemId }) => knowledgeItemId), ['xiaoneng-evidence-rule']);
assert.ok(pack.omissions.some(({ itemId, reason }) => itemId === 'other-project-private-rule' && reason === 'unauthorized'));
assert.ok(pack.omissions.some(({ itemId, reason }) => itemId === 'stale-console-code-fact' && reason === 'stale'));
assert.equal(pack.projectId, snapshot.projectId);
assert.equal(pack.repositoryId, snapshot.repositoryId);
assert.equal(pack.repositoryCommit, snapshot.commit);

const policyDigest = adapter.digest({
  policyId: 'max-console-context-pilot-readonly-v1',
  approvedPaths: snapshot.approvedPaths,
  allowWrites: false,
});
const lock = {
  contractVersion: '1.0',
  contextLockId: 'max-console-context-pilot-lock-001',
  taskId: 'max-console-contextpack-pilot-v1',
  stage: 'verify',
  projectId: snapshot.projectId,
  repositoryId: snapshot.repositoryId,
  branch: snapshot.branch,
  repositoryCommit: snapshot.commit,
  contextPackDigest: pack.contextDigest,
  policyDigest,
  lockedAt: capturedAt,
};
const current = {
  taskId: lock.taskId,
  stage: lock.stage,
  projectId: lock.projectId,
  repositoryId: lock.repositoryId,
  branch: lock.branch,
  repositoryCommit: lock.repositoryCommit,
  contextPackDigest: lock.contextPackDigest,
  policyDigest: lock.policyDigest,
};
compiler.validateContextLock(lock, current, adapter);
const evidence = compiler.projectContextEvidence(request, pack, lock, 'context-pack', adapter);

const payloadText = JSON.stringify({ snapshot, request, pack, lock, evidence });
assert.equal(payloadText.includes(repositoryRoot), false);
const replay = clone({ snapshot, request, pack, lock, evidence });
compiler.validateContextPack(replay.pack, adapter);
compiler.validateContextLock(replay.lock, {
  taskId: replay.lock.taskId,
  stage: replay.lock.stage,
  projectId: replay.lock.projectId,
  repositoryId: replay.lock.repositoryId,
  branch: replay.lock.branch,
  repositoryCommit: replay.lock.repositoryCommit,
  contextPackDigest: replay.lock.contextPackDigest,
  policyDigest: replay.lock.policyDigest,
}, adapter);
const unsealedPack = clone(replay.pack);
delete unsealedPack.contextDigest;
assert.equal(adapter.digest(unsealedPack), replay.pack.contextDigest);
assert.equal(replay.evidence.contextPackDigest, replay.pack.contextDigest);
assert.deepEqual(replay.evidence.selectedKnowledgeItemIds, ['xiaoneng-evidence-rule']);
assert.equal(replay.evidence.requestDigest, adapter.digest(replay.request));
assert.equal(replay.evidence.lockDigest, adapter.digest(replay.lock));

assert.throws(
  () => compiler.captureRepositorySnapshot({ ...snapshotInput, approvedPaths: ['/private/source'] }, adapter),
  /REPOSITORY_PATH_NOT_RELATIVE/,
);

const driftResults = [];
for (const [id, key, value] of [
  ['commit-drift', 'repositoryCommit', '1111111111111111111111111111111111111111'],
  ['pack-drift', 'contextPackDigest', '2'.repeat(64)],
  ['policy-drift', 'policyDigest', '3'.repeat(64)],
]) {
  let writableCalls = 0;
  assert.throws(() => {
    compiler.validateContextLock(lock, { ...current, [key]: value }, adapter);
    writableCalls += 1;
  }, /CONTEXT_LOCK_DRIFT/);
  assert.equal(writableCalls, 0);
  driftResults.push({ id, writableCalls });
}

const after = {
  branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git('rev-parse', 'HEAD'),
  status: git('status', '--porcelain=v1'),
};
assert.deepEqual(after, before);

const results = [
  { id: 'console-snapshot-request-deterministic', ok: true, branch: snapshot.branch, commit: snapshot.commit },
  { id: 'pack-provenance-and-scope', ok: true, selected: evidence.selectedKnowledgeItemIds, omissions: pack.omissions },
  { id: 'context-lock-and-replay', ok: true, contextPackDigest: pack.contextDigest, lockDigest: evidence.lockDigest },
  { id: 'unsafe-path-rejected', ok: true },
  { id: 'drift-fail-closed', ok: true, driftResults },
  { id: 'console-worktree-status-parity', ok: true, status: after.status.split('\n').filter(Boolean) },
];
for (const result of results) console.log(JSON.stringify(result));
console.log(JSON.stringify({ pilot: 'max-console-ui-contextpack-v1', tests: results.length, failures: 0 }));
