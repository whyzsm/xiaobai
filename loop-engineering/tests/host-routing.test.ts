import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir } from 'node:fs/promises';
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
