import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { HarnessRuntime } from '../packages/harness-runtime/src/harnessRuntime';
import { findLoopSpec, listLoopSpecs, readYamlFile } from '../packages/shared/src/fs';
import {
  discoverSkillPackageLoops,
  findSkillPackageLoopSpec,
  resolveSkillPackageAgentPath,
  resolveSkillPackageAssets,
  resolveSkillPackageAssetsForLoop,
  SkillPackageAssetPlan
} from '../packages/shared/src/skillPackageAssets';
import { LoopSpec, ProjectSpec } from '../packages/shared/src/types';

test('skill package assets take precedence for declared loops and referenced harness files', async () => {
  const fixture = await createFixture(true);
  const loopPath = await findLoopSpec(fixture.workspaceRoot, 'ane-standard-page');
  assert.equal(loopPath, await realpath(fixture.packageLoopPath));

  const loop = await readYamlFile<LoopSpec>(loopPath);
  const harness = await new HarnessRuntime(fixture.workspaceRoot).load(loop);
  assert.equal(harness.metadata.id, 'package-harness');

  const discovery = await discoverSkillPackageLoops(fixture.workspaceRoot);
  assert.deepEqual([...discovery.declaredIds], ['ane-standard-page']);
  assert.equal(discovery.pathsById.get('ane-standard-page'), await realpath(fixture.packageLoopPath));
  assert.equal(resolveSkillPackageAgentPath(fixture.assets, 'ane-standard-page.harness.yaml'), await realpath(fixture.harnessPath));
  assert.equal(await findSkillPackageLoopSpec(fixture.workspaceRoot, 'ane-standard-page'), await realpath(fixture.packageLoopPath));
});

test('top-level standalone Projects resolve shared catalog Skill Package assets without duplication', async (t) => {
  const fixture = await createFixture(true);
  const catalogPath = path.join(fixture.projectRoot, '.loop', 'project.yaml');
  const catalog = await readYamlFile<ProjectSpec>(catalogPath);
  await writeFile(catalogPath, JSON.stringify({ ...catalog, role: 'catalog' }), 'utf8');

  const standaloneRoot = path.join(fixture.workspaceRoot, 'projects', 't-max-child');
  await mkdir(path.join(standaloneRoot, '.loop'), { recursive: true });
  await writeFile(
    path.join(standaloneRoot, '.loop', 'project.yaml'),
    JSON.stringify({
      kind: 'Project',
      role: 'standalone',
      id: 't-max-child',
      name: 'T-MAX Child',
      root: '.',
      defaultBranch: 'master',
      parentGroup: 't-max',
      catalogId: 't-max',
      repositories: []
    }),
    'utf8'
  );

  t.after(() => rm(path.dirname(fixture.workspaceRoot), { recursive: true, force: true }));
  const standalone = await readYamlFile<ProjectSpec>(path.join(standaloneRoot, '.loop', 'project.yaml'));
  assert.equal(standalone.role, 'standalone');
  const loop = await readYamlFile<LoopSpec>(fixture.packageLoopPath);
  loop.handoff.project = 't-max-child';
  await writeFile(fixture.packageLoopPath, JSON.stringify(loop), 'utf8');
  const plan = await resolveSkillPackageAssetsForLoop(fixture.workspaceRoot, loop);
  assert.equal(plan?.projectId, 't-max-child');
  assert.equal(plan?.available, true);
  assert.equal(plan?.root, await realpath(path.dirname(path.dirname(path.dirname(fixture.packageLoopPath)))));
  assert.equal(plan?.loops.get('ane-standard-page'), await realpath(fixture.packageLoopPath));

  const discovery = await discoverSkillPackageLoops(fixture.workspaceRoot);
  assert.deepEqual([...discovery.declaredIds], ['ane-standard-page']);
  assert.deepEqual(discovery.paths, [await realpath(fixture.packageLoopPath)]);
});

test('the same shared Skill Package mount is resolved once across ProjectGroups', async () => {
  const fixture = await createFixture(true);
  const root = path.dirname(fixture.workspaceRoot);
  const otherProjectRoot = path.join(fixture.workspaceRoot, 'projects', 'other');
  await mkdir(path.join(otherProjectRoot, '.loop'), { recursive: true });
  await writeFile(
    path.join(otherProjectRoot, '.loop', 'project.yaml'),
    JSON.stringify({
      ...projectFixture(path.relative(otherProjectRoot, path.join(root, 'xiaoneng'))),
      id: 'other',
      name: 'Other'
    }),
    'utf8'
  );

  try {
    const discovery = await discoverSkillPackageLoops(fixture.workspaceRoot);
    assert.deepEqual([...discovery.declaredIds], ['ane-standard-page']);
    assert.deepEqual(discovery.paths, [await realpath(fixture.packageLoopPath)]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('same-named Skill Package Loops from different mounts fail closed', async () => {
  const fixture = await createFixture(true);
  const root = path.dirname(fixture.workspaceRoot);
  const otherProjectRoot = path.join(fixture.workspaceRoot, 'projects', 'other');
  const otherPackageRoot = path.join(root, 'other-xiaoneng');
  const otherLoopPath = path.join(otherPackageRoot, 'xiaobai', 'loops', 'ane-standard-page.loop.yaml');
  const otherHarnessPath = path.join(otherPackageRoot, 'xiaobai', 'agents', 'ane-standard-page.harness.yaml');
  await mkdir(path.join(otherProjectRoot, '.loop'), { recursive: true });
  await mkdir(path.dirname(otherLoopPath), { recursive: true });
  await mkdir(path.dirname(otherHarnessPath), { recursive: true });
  await writeFile(otherLoopPath, JSON.stringify(loopFixture('other-package-harness')), 'utf8');
  await writeFile(otherHarnessPath, JSON.stringify(harnessFixture('other-package-harness')), 'utf8');
  await writeFile(
    path.join(otherProjectRoot, '.loop', 'project.yaml'),
    JSON.stringify({
      ...projectFixture(path.relative(otherProjectRoot, otherPackageRoot)),
      id: 'other',
      name: 'Other'
    }),
    'utf8'
  );

  try {
    await assert.rejects(
      discoverSkillPackageLoops(fixture.workspaceRoot),
      /Skill package loop is declared by multiple projects: ane-standard-page/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a declared loop is not served by the workspace copy when its package mount is unavailable', async () => {
  const fixture = await createFixture(false);
  const discovery = await discoverSkillPackageLoops(fixture.workspaceRoot);

  assert.deepEqual([...discovery.declaredIds], ['ane-standard-page']);
  assert.deepEqual(discovery.paths, []);
  assert.deepEqual(await listLoopSpecs(fixture.workspaceRoot), []);
  await assert.rejects(
    findLoopSpec(fixture.workspaceRoot, 'ane-standard-page'),
    /Skill package mount unavailable for declared loop: ane-standard-page/
  );
});

test('a present package mount with a missing declaration fails closed', async () => {
  const fixture = await createFixture(true, false);

  await assert.rejects(
    findLoopSpec(fixture.workspaceRoot, 'ane-standard-page'),
    /skill package loop ane-standard-page is declared but missing/
  );
});

test('a declared package asset symlink cannot escape the package mount', async () => {
  const fixture = await createFixture(true);
  const outside = await mkdtemp(path.join('/tmp', 'skill-package-assets-outside-'));
  try {
    const outsideLoop = path.join(outside, 'escape.loop.yaml');
    await writeFile(outsideLoop, JSON.stringify(loopFixture('outside')), 'utf8');
    await rm(fixture.packageLoopPath);
    await symlink(outsideLoop, fixture.packageLoopPath);
    await assert.rejects(
      resolveSkillPackageAssets(fixture.projectRoot, fixture.project),
      /skill package loop ane-standard-page escapes package root/
    );
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

interface Fixture {
  workspaceRoot: string;
  workspaceLoopPath: string;
  packageLoopPath: string;
  harnessPath: string;
  projectRoot: string;
  project: ProjectSpec;
  assets?: SkillPackageAssetPlan;
}

async function createFixture(mountAvailable: boolean, includePackageLoop = true): Promise<Fixture> {
  const root = await mkdtemp(path.join('/tmp', 'skill-package-assets-'));
  const workspaceRoot = path.join(root, 'workspace');
  const projectRoot = path.join(workspaceRoot, 'projects', 't-max');
  const packageRoot = path.join(root, 'xiaoneng');
  const workspaceLoopPath = path.join(workspaceRoot, 'loops', 'ane-standard-page.loop.yaml');
  const packageLoopPath = path.join(packageRoot, 'xiaobai', 'loops', 'ane-standard-page.loop.yaml');
  const harnessPath = path.join(packageRoot, 'xiaobai', 'agents', 'ane-standard-page.harness.yaml');

  await mkdir(path.join(workspaceRoot, 'loops'), { recursive: true });
  await mkdir(path.join(projectRoot, '.loop'), { recursive: true });
  await writeFile(workspaceLoopPath, JSON.stringify(loopFixture('workspace-harness')), 'utf8');
  const projectPath = path.join(projectRoot, '.loop', 'project.yaml');
  await writeFile(projectPath, JSON.stringify(projectFixture(path.relative(projectRoot, packageRoot))), 'utf8');

  if (mountAvailable) {
    await mkdir(path.dirname(harnessPath), { recursive: true });
    await writeFile(harnessPath, JSON.stringify(harnessFixture('package-harness')), 'utf8');
    if (includePackageLoop) {
      await mkdir(path.dirname(packageLoopPath), { recursive: true });
      await writeFile(packageLoopPath, JSON.stringify(loopFixture('package-harness')), 'utf8');
    }
  }

  const project = await readYamlFile<ProjectSpec>(projectPath);
  const assets = mountAvailable && includePackageLoop
    ? await resolveSkillPackageAssets(projectRoot, project)
    : undefined;
  return { workspaceRoot, workspaceLoopPath, packageLoopPath, harnessPath, projectRoot, project, assets: assets ?? undefined };
}

function projectFixture(mount: string): ProjectSpec {
  return {
    kind: 'ProjectGroup',
    id: 't-max',
    name: 'T-MAX',
    root: '.',
    defaultBranch: 'master',
    skill: 'SKILL.md',
    background: {
      id: 'xiaoneng',
      name: 'xiaoneng',
      localPathKey: 'xiaoneng',
      mount,
      integration: {
        kind: 'skill-context',
        version: '2.0.0',
        manifest: 'harness/runtime/manifest.yaml',
        contract: 'harness/contracts/runtime/skill-context.schema.json',
        assets: {
          loops: { 'ane-standard-page': 'xiaobai/loops/ane-standard-page.loop.yaml' },
          agents: ['xiaobai/agents/ane-standard-page.harness.yaml']
        }
      }
    }
  };
}

function loopFixture(harness: string): Record<string, unknown> {
  return {
    kind: 'Loop',
    version: 1,
    metadata: { id: 'ane-standard-page', name: 'ANE Standard Page Loop', owner: 'test' },
    schedule: { type: 'manual', expression: 'on-demand', timezone: 'UTC' },
    discovery: { skill: 'ane-standard-page', sources: [{ type: 'requirement' }] },
    handoff: { strategy: 'test', project: 't-max', worktreeRoot: 'worktrees', branchTemplate: 'loop/{taskId}' },
    generator: { agent: 'frontend-generator.agent.yaml', harness: 'ane-standard-page.harness.yaml' },
    verification: { evaluator: 'ane-standard-page-evaluator.agent.yaml', requiredChecks: [], allowSelfReview: false },
    persistence: { memory: { stateFile: 'memory/state.md', inboxFile: 'memory/inbox.md', runLog: 'memory/runs.jsonl' }, outputs: [] },
    budget: { maxTokensPerRun: 1, maxRetriesPerTask: 0, maxParallelTasks: 1 },
    humanGate: {
      requiredBefore: ['coding'],
      reviewers: ['test'],
      gates: [{ id: 'coding-approval', requiredBefore: 'coding', reviewers: ['test'], subjectFields: ['taskId'], requiredEvidenceTypes: ['review'], maxAgeMinutes: 1 }]
    },
    testHarness: harness
  };
}

function harnessFixture(id: string): Record<string, unknown> {
  return {
    kind: 'Harness',
    version: 1,
    metadata: { id },
    tools: { allow: [], deny: [] },
    context: { loaders: [], maxCharacters: 1000 },
    completion: { type: 'staged-objective', conditions: [] },
    failure: {},
    output: { required: [] }
  };
}
