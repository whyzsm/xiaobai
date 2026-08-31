import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { findLoopSpec } from '../packages/shared/src/fs';

const workspaceRoot = path.resolve('workspace');

test('LoopRuntime exposes one frozen ProjectContext on the plan and route', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const plan = await new LoopRuntime().dryRun({
    workspaceRoot,
    loopPath,
    targetRepository: 'operateSupport',
    now: new Date('2026-08-28T00:00:00.000Z')
  });

  assert.equal(plan.projectContext.projectId, 'tmax-operate-support');
  assert.equal(plan.projectRoute.projectContext, plan.projectContext);
  assert.equal(plan.orchestrator?.routesTo.project, plan.projectRoute);
  assert.equal(Object.isFrozen(plan.projectContext), true);
  assert.equal(plan.projectContext.repositoryRoot.endsWith('/repos/operateSupport'), true);
  assert.equal(plan.projectContext.memoryNamespace, 'project:tmax-operate-support/loop:frontend-delivery');
  assert.match(plan.projectContext.policyDigest, /^[a-f0-9]{64}$/);
});

test('LoopRuntime rejects an unscoped run instead of using loop default project', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');

  await assert.rejects(
    new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      now: new Date('2026-08-28T00:00:00.000Z')
    }),
    /requires a target project or repository/
  );
});
