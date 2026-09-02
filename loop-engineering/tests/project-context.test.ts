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

test('T-MAX child Projects inherit the shared IMA knowledge binding', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'ane-standard-page');
  const children = [
    ['tmax-kpiui', 'KPIUI'],
    ['tmax-max-console-ui', 'max-console-ui'],
    ['tmax-max-operate-monitor-ui', 'max-operate-monitor-ui'],
    ['tmax-operate-business', 'operateBusiness'],
    ['tmax-operate-support', 'operateSupport'],
    ['tmax-dcm', 'dcm'],
    ['tmax-scan', 'scan'],
    ['tmax-emt', 'emt']
  ] as const;

  for (const [projectId, repository] of children) {
    const plan = await new LoopRuntime().dryRun({
      workspaceRoot,
      loopPath,
      targetProject: projectId,
      targetRepository: repository,
      targetCwd: `.local/t-max/mounts/repos/${repository}`
    });
    const shared = plan.contextBindings?.find((binding) => binding.knowledgeId === 'know_tmax_shared_ima');
    assert.equal(shared?.scope, 't-max');
    assert.equal(shared?.scopeKind, 'shared');
    assert.equal(shared?.readOnly, true);
  }
});
