import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, pathExists, readText } from '../packages/shared/src/fs';
import { validateWorkspace } from '../packages/shared/src/validation';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const execFileAsync = promisify(execFile);

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

test('simulation writes report, memory, and knowledge artifacts', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'loop-sim-'));
  const tempWorkspace = path.join(tempRoot, 'workspace');
  await execFileAsync('cp', ['-R', workspaceRoot, tempWorkspace]);
  const loopPath = await findLoopSpec(tempWorkspace, 'morning-triage');
  const runtime = new SimulationRuntime();
  const result = await runtime.simulate({
    workspaceRoot: tempWorkspace,
    repoRoot: tempRoot,
    loopPath,
    now: new Date('2026-06-28T01:02:03.000Z')
  });

  assert.equal(result.mode, 'simulation');
  assert.equal(result.stages.length, 6);
  assert.equal(result.summary.findings, 3);
  assert.equal(await pathExists(result.artifacts.reportPath), true);
  assert.equal(await pathExists(result.artifacts.casePath), true);
  assert.equal(await pathExists(result.artifacts.casesIndexPath), true);

  const report = await readText(result.artifacts.reportPath);
  assert.match(report, /初始化 Loop 工作空间/);
  assert.match(report, /知识沉淀/);

  const state = await readText(result.artifacts.statePath);
  assert.match(state, /simulation/);
  assert.match(state, /Auth tests failing on main/);

  const caseBody = await readText(result.artifacts.casePath);
  assert.match(caseBody, /## Rule/);
  assert.match(caseBody, /端到端模拟/);
});
