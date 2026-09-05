import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const scopeModule = path.join(repoRoot, 'workspace/host/xiaobai-host-scope.mjs');

test('Xiaobai host scope accepts only the engineering checkout', async () => {
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'xiaobai-host-routing-'));
  const directTmaxRepository = path.join(externalRoot, 'T-MAX', 'operateBusiness');
  const independentProject = path.join(externalRoot, 'harmonyWardrobe');
  await mkdir(directTmaxRepository, { recursive: true });
  await mkdir(independentProject, { recursive: true });

  assert.equal(await checkScope(repoRoot, repoRoot), true);
  assert.equal(await checkScope(repoRoot, path.join(repoRoot, 'workspace', 'projects', 't-max')), true);
  assert.equal(await checkScope(repoRoot, directTmaxRepository), false);
  assert.equal(await checkScope(repoRoot, independentProject), false);
  assert.equal(
    await checkScope(repoRoot, path.join(repoRoot, 'workspace', '.local', 't-max', 'mounts', 'repos', 'operateBusiness')),
    false
  );
});

async function checkScope(projectRoot: string, targetCwd: string): Promise<boolean> {
  const moduleUrl = pathToFileURL(scopeModule).href;
  const script = `import { isXiaobaiProjectContext } from ${JSON.stringify(moduleUrl)};\n` +
    `process.stdout.write(String(await isXiaobaiProjectContext(${JSON.stringify(projectRoot)}, ${JSON.stringify(targetCwd)})));`;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repoRoot
  });
  return stdout.trim() === 'true';
}

test('build staleness guard skips fresh builds and catches stale sources', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'xiaobai-build-stale-'));
  const srcDir = path.join(root, 'src');
  const srcFile = path.join(srcDir, 'loop.ts');
  const tsconfig = path.join(root, 'tsconfig.json');
  const cli = path.join(root, 'dist', 'cli.js');
  await mkdir(srcDir, { recursive: true });
  await writeFile(srcFile, 'export {};\n');
  await writeFile(tsconfig, '{}\n');
  await mkdir(path.dirname(cli), { recursive: true });
  await writeFile(cli, 'compiled\n');

  const oldTime = Date.now() / 1000 - 1000;
  const freshTime = Date.now() / 1000 - 500;
  const staleTime = Date.now() / 1000 + 500;
  await utimes(srcFile, oldTime, oldTime);
  await utimes(tsconfig, oldTime, oldTime);
  await utimes(cli, freshTime, freshTime);

  // Fresh dist newer than every source input: no rebuild needed.
  assert.equal(await checkStale(cli, [srcDir, tsconfig]), false);

  // A source file newer than dist must trigger a rebuild.
  await utimes(srcFile, staleTime, staleTime);
  assert.equal(await checkStale(cli, [srcDir, tsconfig]), true);

  // A tsconfig newer than dist must also trigger a rebuild.
  await utimes(srcFile, oldTime, oldTime);
  await utimes(tsconfig, staleTime, staleTime);
  assert.equal(await checkStale(cli, [srcDir, tsconfig]), true);

  // A missing CLI is always stale.
  await utimes(tsconfig, oldTime, oldTime);
  await rm(cli);
  assert.equal(await checkStale(cli, [srcDir, tsconfig]), true);

  await rm(root, { recursive: true, force: true });
});

async function checkStale(cliPath: string, sourcePaths: string[]): Promise<boolean> {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'workspace/host/build-if-stale.mjs')).href;
  const script = `import { isBuildStale } from ${JSON.stringify(moduleUrl)};\n` +
    `process.stdout.write(String(isBuildStale(${JSON.stringify(cliPath)}, ${JSON.stringify(sourcePaths)})));`;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repoRoot
  });
  return stdout.trim() === 'true';
}
