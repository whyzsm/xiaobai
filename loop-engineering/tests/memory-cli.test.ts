import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { test } from 'node:test';
import { pathExists } from '../packages/shared/src/fs';

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

async function createTempWorkspace() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'memory-cli-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const vaultRoot = path.join(tempRoot, 'vault');
  await execFileAsync('cp', ['-R', path.join(repoRoot, 'workspace'), workspaceRoot]);
  await mkdir(path.join(vaultRoot, '.obsidian'), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, 'workspace.local.yaml'),
    `memoryRoot: ${vaultRoot}/88-学习/10-项目记忆/demo\n`,
    'utf8'
  );
  return { tempRoot, workspaceRoot, vaultRoot };
}

async function runLoop(args: string[]) {
  const result = await execFileAsync('node', ['dist/loop-engineering/cli/loop.js', ...args], {
    cwd: repoRoot,
    maxBuffer: 1024 * 1024 * 8
  });
  return JSON.parse(result.stdout);
}

test('memory init previews and writes project-isolated Obsidian structure', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  const preview = await runLoop([
    'memory',
    'init',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--json'
  ]);

  assert.equal(preview.ok, true);
  assert.equal(preview.preview, true);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习')), false);

  const written = await runLoop([
    'memory',
    'init',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--write',
    '--json'
  ]);

  assert.equal(written.ok, true);
  assert.equal(written.preview, false);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', '10-项目记忆', 'demo', 'index.md')), true);
});

test('memory init does not create a new dated seed case when one already exists', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  const casesRoot = path.join(vaultRoot, '88-学习', '10-项目记忆', 'demo', 'cases');
  const oldSeedCase = path.join(casesRoot, '1999-01-01-seed-case.md');
  const todaySeedCase = path.join(casesRoot, `${new Date().toISOString().slice(0, 10)}-seed-case.md`);
  await mkdir(casesRoot, { recursive: true });
  await writeFile(
    oldSeedCase,
    `---\ntitle: "Seed Case"\nstatus: seed\ntype: case\n---\n\n# Seed Case\n`,
    'utf8'
  );

  const written = await runLoop([
    'memory',
    'init',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--write',
    '--json'
  ]);

  assert.equal(written.ok, true);
  assert.equal(await pathExists(oldSeedCase), true);
  assert.equal(await pathExists(todaySeedCase), false);
});

test('memory snapshot writes project memory into Obsidian and refreshes the index', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  await runLoop([
    'memory',
    'init',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--write',
    '--json'
  ]);

  const snapshot = await runLoop([
    'memory',
    'snapshot',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--write',
    '--json'
  ]);

  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.preview, false);
  assert.equal(await pathExists(snapshot.snapshotPath), true);
  assert.match(snapshot.snapshotPath, /snapshots\/\d{4}-\d{2}-\d{2}-project-memory-snapshot\.md$/);
  const content = await readFile(snapshot.snapshotPath, 'utf8');
  assert.match(content, /# demo 项目记忆快照/);
  assert.match(content, /## 中文/);
  assert.match(content, /## English/);
  assert.match(content, /project-profile\.md/);
  assert.match(content, /active-context\.md/);

  const secondSnapshot = await runLoop([
    'memory',
    'snapshot',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--write',
    '--json'
  ]);
  const secondContent = await readFile(secondSnapshot.snapshotPath, 'utf8');
  assert.doesNotMatch(secondContent, /snapshots\/\d{4}-\d{2}-\d{2}-project-memory-snapshot\.md/);

  const search = await runLoop([
    'memory',
    'search',
    '项目记忆快照',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--json'
  ]);
  assert(search.matches.some((match: { path: string }) => match.path === snapshot.snapshotPath));
});

test('memory checkpoint persists a case and snapshot under the machine-local vault', async () => {
  const { tempRoot, workspaceRoot, vaultRoot } = await createTempWorkspace();
  const bodyPath = path.join(tempRoot, 'checkpoint.md');
  await writeFile(bodyPath, '## 中文\n\n修复记忆持久化。\n\n## English\n\nFixed memory persistence.\n', 'utf8');
  await runLoop(['memory', 'init', '--workspace', workspaceRoot, '--project', 'demo', '--loop', 'morning-triage', '--write', '--json']);

  const checkpoint = await runLoop([
    'memory', 'checkpoint', '--workspace', workspaceRoot, '--project', 'demo', '--loop', 'morning-triage',
    '--title', 'Memory persistence fix', '--body', bodyPath, '--write', '--json'
  ]);

  assert.equal(checkpoint.ok, true);
  assert.equal(checkpoint.preview, false);
  assert.equal(await pathExists(checkpoint.written.path), true);
  assert.equal(await pathExists(checkpoint.snapshotPath), true);
  assert.equal(checkpoint.written.path.startsWith(vaultRoot), true);
  assert.match(await readFile(checkpoint.written.path, 'utf8'), /Fixed memory persistence/);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', '00-记忆索引', 'memory-index.json')), true);
});

test('memory index rebases synced absolute paths to the current computer vault', async () => {
  const first = await createTempWorkspace();
  await runLoop(['memory', 'init', '--workspace', first.workspaceRoot, '--project', 'demo', '--write', '--json']);
  await runLoop(['memory', 'index', '--workspace', first.workspaceRoot, '--project', 'demo', '--write', '--json']);

  const secondRoot = await mkdtemp(path.join(tmpdir(), 'memory-cli-second-machine-'));
  const secondWorkspace = path.join(secondRoot, 'workspace');
  const secondVault = path.join(secondRoot, 'vault');
  await execFileAsync('cp', ['-R', first.workspaceRoot, secondWorkspace]);
  await execFileAsync('cp', ['-R', first.vaultRoot, secondVault]);
  await writeFile(
    path.join(secondWorkspace, 'workspace.local.yaml'),
    `memoryRoot: ${secondVault}/88-学习/10-项目记忆/demo\nmemoryVaultRoot: ${secondVault}\n`,
    'utf8'
  );

  const validation = await runLoop(['memory', 'validate', '--workspace', secondWorkspace, '--project', 'demo', '--json']);
  const search = await runLoop(['memory', 'search', 'demo', '--workspace', secondWorkspace, '--project', 'demo', '--json']);
  assert.equal(validation.ok, true);
  assert.deepEqual(validation.warnings, []);
  assert(search.matches.length > 0);
  assert(search.matches.every((match: { path: string }) => match.path.startsWith(secondVault)));
});

test('memory lifecycle indexes, searches, builds context, captures, promotes, validates, doctors, and reports', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  await runLoop(['memory', 'init', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--loop', 'morning-triage', '--write', '--json']);

  const index = await runLoop(['memory', 'index', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--write', '--json']);
  assert.equal(index.ok, true);
  assert.equal(index.preview, false);
  assert.equal(index.summary.projects, 1);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', '00-记忆索引', 'memory-index.json')), true);

  const search = await runLoop(['memory', 'search', 'demo', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json']);
  assert.equal(search.ok, true);
  assert(search.matches.length > 0);

  const context = await runLoop(['memory', 'context', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--loop', 'morning-triage', '--json']);
  assert.equal(context.ok, true);
  assert(context.bundle.included.length > 0);

  const capturePreview = await runLoop([
    'memory',
    'capture',
    'case',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--title',
    'Auth Triage Lesson',
    '--json'
  ]);
  assert.equal(capturePreview.preview, true);

  const capture = await runLoop([
    'memory',
    'capture',
    'case',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--title',
    'Auth Triage Lesson',
    '--write',
    '--json'
  ]);
  assert.equal(capture.ok, true);
  assert.equal(await pathExists(capture.written.path), true);

  const foundCase = await runLoop(['memory', 'search', 'Auth', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json']);
  assert(foundCase.matches.some((match: { title: string }) => match.title === 'Auth Triage Lesson'));

  const noMatches = await runLoop([
    'memory',
    'search',
    '完全不存在的检索词',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--json'
  ]);
  assert.deepEqual(noMatches.matches, []);

  const promotePreview = await runLoop([
    'memory',
    'promote',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--case',
    capture.written.path,
    '--json'
  ]);
  assert.equal(promotePreview.preview, true);

  const promote = await runLoop([
    'memory',
    'promote',
    '--workspace',
    workspaceRoot,
    '--vault',
    vaultRoot,
    '--project',
    'demo',
    '--case',
    capture.written.path,
    '--confirm',
    '--json'
  ]);
  assert.equal(promote.ok, true);
  assert.equal(await pathExists(promote.patternPath), true);
  assert.match(await readFile(capture.written.path, 'utf8'), /Promoted Patterns/);
  assert.match(
    await readFile(path.join(vaultRoot, '88-学习', '00-记忆索引', 'patterns.md'), 'utf8'),
    /Auth Triage Lesson Pattern/
  );

  const validation = await runLoop(['memory', 'validate', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json']);
  assert.equal(validation.ok, true, validation.errors.join('\n'));

  const doctor = await runLoop(['memory', 'doctor', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json']);
  assert.equal(doctor.ok, true);
  assert(doctor.report.score >= 0);

  const reportPreview = await runLoop(['memory', 'report', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json']);
  assert.equal(reportPreview.preview, true);

  const report = await runLoop(['memory', 'report', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--write', '--json']);
  assert.equal(report.ok, true);
  assert.equal(await pathExists(report.reportPath), true);
  assert.match(await readFile(report.reportPath, 'utf8'), /Memory Report/);
});

test('memory cli infers nested learning root from local memory root', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  await writeFile(
    path.join(workspaceRoot, 'workspace.local.yaml'),
    `memoryRoot: ${vaultRoot}/88-学习/xiaobai/10-项目记忆/demo\n`,
    'utf8'
  );

  const written = await runLoop([
    'memory',
    'init',
    '--workspace',
    workspaceRoot,
    '--project',
    'demo',
    '--loop',
    'morning-triage',
    '--write',
    '--json'
  ]);
  assert.equal(written.ok, true);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', 'xiaobai', '10-项目记忆', 'demo', 'index.md')), true);

  const index = await runLoop(['memory', 'index', '--workspace', workspaceRoot, '--project', 'demo', '--write', '--json']);
  assert.equal(index.ok, true);
  assert.equal(index.summary.indexPath, path.join(vaultRoot, '88-学习', 'xiaobai', '00-记忆索引', 'memory-index.json'));
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', 'xiaobai', '00-记忆索引', 'memory-index.json')), true);
  assert.equal(await pathExists(path.join(vaultRoot, '88-学习', '00-记忆索引', 'memory-index.json')), false);
});

test('memory search reports missing index instead of silently scanning', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  await runLoop(['memory', 'init', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--write', '--json']);
  await assert.rejects(
    () => execFileAsync('node', ['dist/loop-engineering/cli/loop.js', 'memory', 'search', 'demo', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json'], { cwd: repoRoot }),
    /Memory index not found/
  );
});
