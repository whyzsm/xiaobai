import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { WorktreeManager } from '../packages/worktree-manager/src/worktreeManager';
import { LoopSpec } from '../packages/shared/src/types';
import { pathExists } from '../packages/shared/src/fs';

const execFileAsync = promisify(execFile);

async function createGitFixture() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'worktree-manager-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const repositoryPath = path.join(tempRoot, 'repo');
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(repositoryPath, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'initial'],
    { cwd: repositoryPath }
  );
  return {
    tempRoot,
    workspaceRoot,
    repositoryPath,
    manager: new WorktreeManager(workspaceRoot, loopFixture(), 't-max')
  };
}

test('worktree manager prepares claims heartbeats and cleanly releases git worktrees', async () => {
  const { manager, repositoryPath } = await createGitFixture();
  const prepared = await manager.prepare({
    taskId: 'task-1',
    repositoryId: 'operateBusiness',
    repositoryPath,
    now: new Date('2026-08-15T00:00:00.000Z')
  });

  assert.equal(prepared.state, 'prepared');
  assert.equal(prepared.branch, 'loop/frontend-delivery/2026-08-15/task-1');
  assert.equal((await stat(prepared.path)).isDirectory(), true);

  const claimed = await manager.claim({
    leaseId: prepared.leaseId,
    ownerId: 'codex',
    providerProfileId: 'codex-cli-writable',
    now: new Date('2026-08-15T00:01:00.000Z')
  });
  assert.equal(claimed.state, 'claimed');
  assert.equal(claimed.owner?.role, 'writer');
  await assert.rejects(
    () => manager.claim({ leaseId: prepared.leaseId, ownerId: 'claude' }),
    /lease_already_owned/
  );

  const active = await manager.heartbeat(prepared.leaseId, new Date('2026-08-15T00:02:00.000Z'));
  assert.equal(active.state, 'active');

  const released = await manager.release(prepared.leaseId, new Date('2026-08-15T00:03:00.000Z'));
  assert.equal(released.state, 'released');
  assert.equal(await pathExists(prepared.path), false);
});

test('worktree manager preserves dirty worktrees on release and recovery marks expired leases', async () => {
  const { manager, repositoryPath } = await createGitFixture();
  const dirtyLease = await manager.prepare({
    taskId: 'dirty-task',
    repositoryId: 'operateBusiness',
    repositoryPath,
    now: new Date('2026-08-15T00:00:00.000Z')
  });
  await manager.claim({
    leaseId: dirtyLease.leaseId,
    ownerId: 'codex',
    now: new Date('2026-08-15T00:01:00.000Z')
  });
  await writeFile(path.join(dirtyLease.path, 'new-file.txt'), 'dirty\n', 'utf8');
  const retained = await manager.release(dirtyLease.leaseId, new Date('2026-08-15T00:02:00.000Z'));

  assert.equal(retained.state, 'dirty_retained');
  assert.equal(await pathExists(dirtyLease.path), true);

  const expiringLease = await manager.prepare({
    taskId: 'expiring-task',
    repositoryId: 'operateBusiness',
    repositoryPath,
    now: new Date('2026-08-15T00:03:00.000Z')
  });
  await manager.claim({
    leaseId: expiringLease.leaseId,
    ownerId: 'claude',
    heartbeatIntervalMs: 1,
    now: new Date('2026-08-15T00:03:00.000Z')
  });
  const recovered = await manager.recoverExpired(new Date('2026-08-15T00:03:01.000Z'));

  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].leaseId, expiringLease.leaseId);
  assert.equal(recovered[0].state, 'stale');
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
      worktreeRoot: '.local/frontend-delivery/worktrees',
      branchTemplate: 'loop/frontend-delivery/{date}/{taskId}'
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
      maxParallelTasks: 2
    },
    humanGate: {
      requiredBefore: [],
      reviewers: [],
      gates: []
    }
  };
}
