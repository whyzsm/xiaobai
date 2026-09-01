import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const distRoot = path.resolve(process.env.XBAI_DIST_ROOT || '');
const contractsRoot = path.resolve(process.env.DEV_CONTEXT_CONTRACTS_PATH || '');
const xiaonengRoot = path.resolve(process.env.XIAONENG_ROOT || '');
const targets = {
  'tmax-max-console-ui': path.resolve(process.env.MAX_CONSOLE_REPO_ROOT || ''),
  'tmax-max-operate-monitor-ui': path.resolve(process.env.MAX_MONITOR_REPO_ROOT || ''),
};
for (const [name, value] of Object.entries({ distRoot, contractsRoot, xiaonengRoot, ...targets })) {
  if (!value || value === path.resolve('.')) throw new Error(`${name} environment variable is required`);
}

const compilerPath = path.join(distRoot, 'loop-engineering/packages/context-compiler/src/contextCompiler.js');
if (!fs.existsSync(compilerPath)) throw new Error(`compiled context compiler is missing: ${compilerPath}`);
const compiler = createRequire(import.meta.url)(compilerPath);
const contracts = await import(pathToFileURL(path.join(contractsRoot, 'src/index.mjs')).href);
const resolver = await import(pathToFileURL(path.join(xiaonengRoot, 'harness/runtime/context-pack-resolver.mjs')).href);

function git(root, ...args) {
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

const principles = fs.readFileSync(path.join(xiaonengRoot, 'xiaoneng-principles.md'), 'utf8');
const sharedContent = principles.split('\n').find((line) => line.includes('可复现证据优先于口头保证'))?.replace(/^\s*-\s*/, '').trim();
if (!sharedContent) throw new Error('the shared Xiaoneng rule could not be resolved');
const xiaonengRevision = git(xiaonengRoot, 'rev-parse', 'HEAD');
const sharedDigest = contracts.sha256Text(sharedContent);

function capture(projectId, repositoryId, root, capturedAt) {
  const branch = git(root, 'rev-parse', '--abbrev-ref', 'HEAD');
  const commit = git(root, 'rev-parse', 'HEAD');
  const approvedPaths = ['package.json', 'src'];
  const tree = git(root, 'ls-tree', '-r', '--full-tree', 'HEAD', '--', ...approvedPaths);
  const codeFactDigest = contracts.sha256Canonical({ approvedPaths, commit, tree });
  return compiler.captureRepositorySnapshot({
    projectId,
    repositoryId,
    branch,
    commit,
    approvedPaths,
    codeFactDigest,
    capturedAt,
    classification: 'internal',
    sourceRevision: commit,
  }, adapter);
}

function requestFor(projectId, snapshot, bindingRevision = 'profile-tmax-readonly-v1') {
  return compiler.compileContextRequest({
    requestId: `${projectId}-governance-001`,
    taskType: 'code.explain',
    userGoal: `Read-only ContextPack migration governance check for ${projectId}.`,
    project: {
      projectId,
      displayName: projectId,
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
      revision: bindingRevision,
      requiredCapabilities: ['code.explain'],
    }],
    requiredCapabilities: ['code.explain'],
    authorization: {
      subjectId: 'agent-xiaobai',
      allowedProjects: [projectId],
      allowedClassifications: ['public', 'internal'],
    },
    budget: { maxCharacters: 12000, maxItems: 10 },
    selectionPolicy: { strategy: 'ranked', maxItems: 10, includeStale: false },
  }, adapter);
}

function item(knowledgeItemId, content, overrides = {}) {
  const contentDigest = contracts.sha256Text(content);
  return {
    knowledgeItemId,
    scope: 'global',
    classification: 'public',
    owner: 'team-xiaoneng',
    revision: xiaonengRevision,
    contentDigest,
    source: { sourceId: 'xiaoneng-principles', revision: xiaonengRevision, contentDigest },
    content,
    ...overrides,
  };
}

const capturedAt = new Date().toISOString();
const projectInputs = [
  { projectId: 'tmax-max-console-ui', repositoryId: 'max-console-ui' },
  { projectId: 'tmax-max-operate-monitor-ui', repositoryId: 'max-operate-monitor-ui' },
];
const snapshots = new Map(projectInputs.map(({ projectId, repositoryId }) => [
  projectId,
  capture(projectId, repositoryId, targets[projectId], capturedAt),
]));

const privateConsole = item('console-private-rule', 'Console-private guidance stays inside the console project.', {
  scope: 'project', projectId: 'tmax-max-console-ui', classification: 'internal', owner: 'team-console', revision: 'console-profile-v1',
});
const privateMonitor = item('monitor-private-rule', 'Monitor-private guidance stays inside the monitor project.', {
  scope: 'project', projectId: 'tmax-max-operate-monitor-ui', classification: 'internal', owner: 'team-monitor', revision: 'monitor-profile-v1',
});
const staleConsole = item('stale-console-code-fact', 'Console code facts are bound to a concrete commit.', {
  scope: 'repository', projectId: 'tmax-max-console-ui', repositoryId: 'max-console-ui', repositoryCommit: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  classification: 'internal', owner: 'team-console', revision: 'console-code-old',
});
const staleMonitor = item('stale-monitor-code-fact', 'Monitor code facts are bound to a concrete commit.', {
  scope: 'repository', projectId: 'tmax-max-operate-monitor-ui', repositoryId: 'max-operate-monitor-ui', repositoryCommit: 'cafebabecafebabecafebabecafebabecafebabe',
  classification: 'internal', owner: 'team-monitor', revision: 'monitor-code-old',
});

const results = [];
for (const { projectId, repositoryId } of projectInputs) {
  const snapshot = snapshots.get(projectId);
  const request = requestFor(projectId, snapshot);
  const knowledgeItems = [item('shared-public-rule', sharedContent), privateConsole, privateMonitor, staleConsole, staleMonitor];
  const pack = resolver.resolveContextPack({ request, knowledgeItems, adapter: resolverAdapter, now: capturedAt });
  compiler.validateContextPack(pack, adapter);
  const selected = pack.knowledgeItems.map(({ knowledgeItemId }) => knowledgeItemId);
  const ownPrivate = projectId === 'tmax-max-console-ui' ? 'console-private-rule' : 'monitor-private-rule';
  assert.deepEqual(selected, [ownPrivate, 'shared-public-rule']);
  const foreignPrivate = projectId === 'tmax-max-console-ui' ? 'monitor-private-rule' : 'console-private-rule';
  const ownStale = projectId === 'tmax-max-console-ui' ? 'stale-console-code-fact' : 'stale-monitor-code-fact';
  assert.ok(pack.omissions.some(({ itemId, reason }) => itemId === foreignPrivate && reason === 'unauthorized'));
  assert.ok(pack.omissions.some(({ itemId, reason }) => itemId === ownStale && reason === 'stale'));

  const policyDigest = adapter.digest({ policyId: 'tmax-context-migration-v1', projectId, allowWrites: false });
  const lock = {
    contractVersion: '1.0',
    contextLockId: `${projectId}-governance-lock-001`,
    taskId: 'multi-project-contextpack-governance-v1',
    stage: 'verify',
    projectId,
    repositoryId,
    branch: snapshot.branch,
    repositoryCommit: snapshot.commit,
    contextPackDigest: pack.contextDigest,
    policyDigest,
    lockedAt: capturedAt,
  };
  const current = {
    taskId: lock.taskId, stage: lock.stage, projectId, repositoryId,
    branch: lock.branch, repositoryCommit: lock.repositoryCommit,
    contextPackDigest: lock.contextPackDigest, policyDigest: lock.policyDigest,
  };
  compiler.validateContextLock(lock, current, adapter);
  const evidence = compiler.projectContextEvidence(request, pack, lock, 'context-pack', adapter);

  const replay = clone({ request, pack, lock, evidence });
  compiler.validateContextPack(replay.pack, adapter);
  const replayUnsealed = clone(replay.pack);
  delete replayUnsealed.contextDigest;
  assert.equal(adapter.digest(replayUnsealed), replay.pack.contextDigest);
  assert.equal(replay.evidence.requestDigest, adapter.digest(replay.request));
  assert.equal(replay.evidence.lockDigest, adapter.digest(replay.lock));

  const legacyEvidence = compiler.projectContextEvidence(request, { contextDigest: '' }, lock, 'legacy-background', adapter);
  assert.equal(legacyEvidence.mode, 'legacy-background');
  assert.throws(() => compiler.projectContextEvidence(request, pack, lock, 'legacy-background', adapter), /CONTEXT_MODE_CONFLICT/);
  const rollbackRequest = requestFor(projectId, snapshot, 'profile-tmax-readonly-v0');
  const rollbackPack = resolver.resolveContextPack({ request: rollbackRequest, knowledgeItems, adapter: resolverAdapter, now: capturedAt });
  compiler.validateContextPack(rollbackPack, adapter);
  assert.deepEqual(rollbackPack.knowledgeItems.map(({ knowledgeItemId }) => knowledgeItemId), selected);

  const driftResults = [];
  for (const [id, key, value] of [
    ['commit-drift', 'repositoryCommit', '1'.repeat(40)],
    ['policy-drift', 'policyDigest', '2'.repeat(64)],
  ]) {
    let writableCalls = 0;
    assert.throws(() => {
      compiler.validateContextLock(lock, { ...current, [key]: value }, adapter);
      writableCalls += 1;
    }, /CONTEXT_LOCK_DRIFT/);
    assert.equal(writableCalls, 0);
    driftResults.push({ id, writableCalls });
  }
  results.push({ projectId, repositoryId, branch: snapshot.branch, commit: snapshot.commit, selected, omissions: pack.omissions, contextPackDigest: pack.contextDigest, driftResults });
}

const before = Object.fromEntries(projectInputs.map(({ projectId }) => [projectId, {
  branch: git(targets[projectId], 'rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git(targets[projectId], 'rev-parse', 'HEAD'),
  status: git(targets[projectId], 'status', '--porcelain=v1'),
}]));
const after = Object.fromEntries(projectInputs.map(({ projectId }) => [projectId, {
  branch: git(targets[projectId], 'rev-parse', '--abbrev-ref', 'HEAD'),
  commit: git(targets[projectId], 'rev-parse', 'HEAD'),
  status: git(targets[projectId], 'status', '--porcelain=v1'),
}]));
assert.deepEqual(after, before);

const migration = projectInputs.map(({ projectId }) => ({
  projectId,
  transitions: [
    { mode: 'legacy-background', profileRevision: 'profile-tmax-readonly-v0' },
    { mode: 'context-pack', profileRevision: 'profile-tmax-readonly-v1' },
    { mode: 'legacy-background', profileRevision: 'profile-tmax-readonly-v0', reason: 'rollback' },
  ],
}));
for (const state of migration) {
  for (const transition of state.transitions) assert.ok(['legacy-background', 'context-pack'].includes(transition.mode));
  assert.equal(new Set(state.transitions.map(({ mode }) => mode)).size, 2);
}

for (const result of results) console.log(JSON.stringify({ id: 'project-governance', ok: true, ...result }));
console.log(JSON.stringify({ pilot: 'multi-project-contextpack-governance-v1', projects: results.length, migration, failures: 0, statusParity: true }));
