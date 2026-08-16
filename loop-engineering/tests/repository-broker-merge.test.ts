import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { MergeRuntime } from '../packages/merge-runtime/src/mergeRuntime';
import { RepositoryActionBroker } from '../packages/repository-action-broker/src/repositoryActionBroker';
import { WorkspaceLease } from '../packages/shared/src/types';

const execFileAsync = promisify(execFile);

test('repository action broker blocks unauthorized push and completes authorized push', async () => {
  const { repositoryPath, remotePath } = await createPushFixture();
  const lease = leaseFixture(repositoryPath, 'loop/task-1');
  const broker = new RepositoryActionBroker();

  const blocked = broker.decide({ action: 'push', lease });
  assert.equal(blocked.status, 'blocked');
  assert.match(blocked.reasons.join('\n'), /gate_required/);

  const pushed = await broker.push({
    action: 'push',
    lease,
    remote: remotePath,
    gateDecision: {
      status: 'passed',
      blockingReasons: [],
      satisfiedGates: ['push-branch']
    }
  });
  assert.equal(pushed.status, 'completed');

  const remoteRefs = (await execFileAsync('git', ['ls-remote', remotePath, 'refs/heads/loop/task-1'], {
    encoding: 'utf8'
  })).stdout;
  assert.match(remoteRefs, /refs\/heads\/loop\/task-1/);

  const mergeBlocked = broker.decide({
    action: 'merge',
    lease,
    gateDecision: {
      status: 'blocked',
      blockingReasons: ['merge approval missing'],
      satisfiedGates: []
    }
  });
  assert.equal(mergeBlocked.status, 'blocked');
  assert.match(mergeBlocked.reasons.join('\n'), /merge approval missing/);

  const dirtyCleanup = broker.decide({
    action: 'destructive_cleanup',
    lease: {
      ...lease,
      state: 'dirty_retained'
    },
    gateDecision: {
      status: 'passed',
      blockingReasons: [],
      satisfiedGates: ['destructive-cleanup']
    }
  });
  assert.equal(dirtyCleanup.status, 'blocked');
  assert.match(dirtyCleanup.reasons.join('\n'), /dirty worktree/);
});

test('merge runtime detects same-line conflicts and blocks promotion plans', async () => {
  const repositoryPath = await createConflictFixture();
  const runtime = new MergeRuntime();
  const conflicts = await runtime.detectConflicts({
    repositoryPath,
    targetBranch: 'main',
    sourceBranches: ['loop/task-a', 'loop/task-b']
  });

  assert(conflicts.length > 0);
  assert(conflicts.some((conflict) => conflict.file === 'app.txt' || conflict.file === '<unknown>'));

  const plan = runtime.buildPromotionPlan({
    taskId: 'task-a',
    sourceBranch: 'loop/task-a',
    targetBranch: 'main',
    requiredGates: ['merge-approval'],
    conflicts,
    evidence: [{ type: 'diff', value: 'merge-tree checked' }]
  });

  assert.equal(plan.state, 'blocked');
  assert.equal(plan.conflicts.length, conflicts.length);
});

async function createPushFixture() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'repo-broker-'));
  const repositoryPath = path.join(tempRoot, 'repo');
  const remotePath = path.join(tempRoot, 'remote.git');
  await mkdir(repositoryPath, { recursive: true });
  await mkdir(remotePath, { recursive: true });
  await execFileAsync('git', ['init', '-q', '--bare'], { cwd: remotePath });
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'initial'],
    { cwd: repositoryPath }
  );
  await execFileAsync('git', ['checkout', '-q', '-b', 'loop/task-1'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'README.md'), 'changed\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'task'],
    { cwd: repositoryPath }
  );
  return { repositoryPath, remotePath };
}

async function createConflictFixture(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'merge-runtime-'));
  const repositoryPath = path.join(tempRoot, 'repo');
  await mkdir(repositoryPath, { recursive: true });
  await execFileAsync('git', ['init', '-q', '-b', 'main'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'app.txt'), 'line one\nshared\nline three\n', 'utf8');
  await execFileAsync('git', ['add', 'app.txt'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'base'],
    { cwd: repositoryPath }
  );

  await execFileAsync('git', ['checkout', '-q', '-b', 'loop/task-a'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'app.txt'), 'line one\ntask a\nline three\n', 'utf8');
  await execFileAsync('git', ['commit', '-am', 'task a', '-q'], { cwd: repositoryPath });

  await execFileAsync('git', ['checkout', '-q', 'main'], { cwd: repositoryPath });
  await execFileAsync('git', ['checkout', '-q', '-b', 'loop/task-b'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'app.txt'), 'line one\ntask b\nline three\n', 'utf8');
  await execFileAsync('git', ['commit', '-am', 'task b', '-q'], { cwd: repositoryPath });

  await execFileAsync('git', ['checkout', '-q', 'main'], { cwd: repositoryPath });
  return repositoryPath;
}

function leaseFixture(repositoryPath: string, branch: string): WorkspaceLease {
  return {
    kind: 'WorkspaceLease',
    version: 1,
    leaseId: 'lease-1',
    taskId: 'task-1',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    repositoryPath,
    baseRef: 'main',
    branch,
    path: repositoryPath,
    state: 'active',
    owner: {
      id: 'codex',
      role: 'writer',
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
