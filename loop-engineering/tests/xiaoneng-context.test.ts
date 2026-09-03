import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import {
  assertTargetOnlyWrite,
  isExcludedSourcePath,
  resolveXiaonengRuntime
} from '../packages/xiaoneng-context-runtime/src';
import { resolveProjectRoute } from '../packages/project-registry/src/projectRegistry';
import { findLoopSpec, readYamlFile } from '../packages/shared/src/fs';
import { LoopSpec } from '../packages/shared/src/types';

const repoRoot = process.cwd();
const workspaceRoot = path.join(repoRoot, 'workspace');
const repositories = [
  'KPIUI',
  'max-console-ui',
  'max-operate-monitor-ui',
  'operateBusiness',
  'operateSupport',
  'dcm',
  'scan'
];

test('T-MAX ProjectGroup routes every registered repository with one target and full scope', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);

  for (const repositoryId of repositories) {
    const route = await resolveProjectRoute(workspaceRoot, loop, { targetRepository: repositoryId });
    assert.equal(route.project.id, 't-max');
    assert.equal(route.project.kind, 'ProjectGroup');
    assert.equal(route.targetRepository?.id, repositoryId);
    assert.deepEqual(route.projectScopeRepositories.map((repository) => repository.id), repositories);
  }
});

test('source-backed resolver consumes the mounted Manifest and derives owner skills', async () => {
  const loopPath = await findLoopSpec(workspaceRoot, 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const route = await resolveProjectRoute(workspaceRoot, loop, { targetRepository: 'operateSupport' });
  const plan = await resolveXiaonengRuntime({
    sourceRoot: path.join(workspaceRoot, '.local/t-max/mounts/background/xiaoneng'),
    projectRoot: path.join(workspaceRoot, 'projects/t-max'),
    project: route.project,
    targetRepository: route.targetRepository!,
    taskId: 'test-page-create',
    executionMode: 'PageImplementation',
    now: new Date('2026-09-03T00:00:00.000Z')
  });

  assert.equal(plan.skillContext.skillId, 'xiaoneng-agent');
  assert.equal(plan.skillContext.executionMode, 'PageImplementation');
  assert.equal(plan.skillContext.ownerAgent, 'watermelon-frontend-agent');
  assert.deepEqual(plan.skillContext.ownerSkills, ['fe-page-workflow', 'fe-typescript-safety']);
  assert.equal(plan.sourceConsumption.files.some((file) => file.path.endsWith('manifest.yaml')), true);
  assert.equal(plan.sourceConsumption.files.some((file) => file.path.endsWith('xiaoneng-agent/SKILL.md')), true);
  assert.equal(plan.taskContextLock.targetRepository, 'operateSupport');
  assert.equal(plan.taskContextLock.projectScopeRepositories.length, 7);
  assert.deepEqual(plan.taskContextLock.authorizedActions, ['implement']);
});

test('source resolver fails closed for a missing mount', async () => {
  const missingRoot = path.join(await mkdtemp(path.join(tmpdir(), 'xiaoneng-missing-')), 'missing');
  await assert.rejects(
    resolveXiaonengRuntime({
      sourceRoot: missingRoot,
      project: { kind: 'ProjectGroup', id: 't-max', name: 'T-MAX', root: '.', defaultBranch: 'master', skill: 'SKILL.md' },
      targetRepository: { id: 'target', name: 'target', mount: missingRoot },
      taskId: 'missing-mount'
    }),
    /source root.*missing/i
  );
});

test('target-only write authorization rejects paths outside the selected repository', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaoneng-target-'));
  await mkdir(path.join(root, 'src'));
  await assert.doesNotReject(assertTargetOnlyWrite(root, path.join(root, 'src', 'page.tsx')));
  await assert.rejects(assertTargetOnlyWrite(root, path.join(path.dirname(root), 'other', 'page.tsx')), /outside target repository/i);
  assert.equal(isExcludedSourcePath('docs/archive/report.md'), true);
  assert.equal(isExcludedSourcePath('runtime/skill-graph.generated.yaml'), true);
  assert.equal(isExcludedSourcePath('harness/runtime/manifest.yaml'), false);
});
