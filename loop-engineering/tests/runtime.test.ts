import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { findLoopSpec } from '../packages/shared/src/fs';
import { validateWorkspace } from '../packages/shared/src/validation';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');

test('workspace validates against schemas and referenced files', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const result = await validateWorkspace(workspaceRoot, loopPath);

  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('dry run creates independent handoff and evaluation plans', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'morning-triage');
  const runtime = new LoopRuntime();
  const plan = await runtime.dryRun({
    workspaceRoot,
    loopPath,
    now: new Date('2026-06-27T00:00:00.000Z')
  });

  assert.equal(plan.loopId, 'morning-triage');
  assert.equal(plan.budget.ok, true);
  assert.equal(plan.findings.length, 3);
  assert.equal(plan.handoff.length, plan.findings.length);
  assert.equal(plan.generatorRuns.length, plan.findings.length);
  assert.equal(plan.evaluations.length, plan.findings.length);
  assert.equal(plan.evaluations.every((evaluation) => evaluation.allowSelfReview === false), true);
  assert.equal(plan.handoff[0].branch, 'loop/morning-triage/2026-06-27/task-001');
  assert.deepEqual(plan.humanGate.protectedActions, ['merge']);
});
