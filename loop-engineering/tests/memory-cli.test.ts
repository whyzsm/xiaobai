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

test('memory search reports missing index instead of silently scanning', async () => {
  const { workspaceRoot, vaultRoot } = await createTempWorkspace();
  await runLoop(['memory', 'init', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--write', '--json']);
  await assert.rejects(
    () => execFileAsync('node', ['dist/loop-engineering/cli/loop.js', 'memory', 'search', 'demo', '--workspace', workspaceRoot, '--vault', vaultRoot, '--project', 'demo', '--json'], { cwd: repoRoot }),
    /Memory index not found/
  );
});
