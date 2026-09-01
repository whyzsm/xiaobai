import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { findLoopSpec, readYamlFile } from '../packages/shared/src/fs';
import { resolveProjectRoute } from '../packages/project-registry/src/projectRegistry';
import { LoopSpec } from '../packages/shared/src/types';

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

test('Project registry routes a top-level standalone Project and ignores its legacy nested copy', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const route = await resolveProjectRoute(workspaceRoot, loop, { targetProject: 'tmax-operate-business' });

  assert.equal(route.project.id, 'tmax-operate-business');
  assert.equal(route.project.role, 'standalone');
  assert.equal(route.project.catalogId, 't-max');
  assert.equal(route.project.parentGroup, 't-max');
  assert.equal(route.project.background?.id, 'xiaoneng');
  assert.equal(path.basename(route.projectRoot), 'tmax-operate-business');

  const repositoryRoute = await resolveProjectRoute(workspaceRoot, loop, { targetRepository: 'operateBusiness' });
  assert.equal(repositoryRoute.project.id, 'tmax-operate-business');
  assert.equal(repositoryRoute.repository?.id, 'operateBusiness');
  assert.equal(path.basename(repositoryRoute.projectRoot), 'tmax-operate-business');
});
