import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const execFileAsync = promisify(execFile);
const repoRoot = process.cwd();
const scopeModule = path.join(repoRoot, 'workspace/host/xiaobai-host-scope.mjs');
const installerScript = path.join(repoRoot, 'workspace/host/install-codex-hook.mjs');
const promptHookScript = path.join(repoRoot, 'workspace/host/xigua-codex-prompt-hook.mjs');

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

test('Codex UserPromptSubmit hook routes KPIUI before assistant processing', async () => {
  const result = await runPromptHook({
    session_id: 'test-session',
    turn_id: 'test-turn',
    transcript_path: null,
    cwd: repoRoot,
    hook_event_name: 'UserPromptSubmit',
    model: 'test-model',
    permission_mode: 'never',
    prompt:
      '在 KPIUI 项目里，新增一个“简易流水管理”页面，在 KPI 一级目录下，需求地址：https://itxuqiu.yuque.com/gzlcs4/nuv8wt/lhu6g7vtqcukrfae'
  });

  assert.equal(result.code, 0, result.stderr);
  const output = JSON.parse(result.stdout) as {
    hookSpecificOutput?: { hookEventName?: string; additionalContext?: string };
  };
  assert.equal(output.hookSpecificOutput?.hookEventName, 'UserPromptSubmit');
  assert.match(output.hookSpecificOutput?.additionalContext ?? '', /\[XIGUA PRE-DISPATCH LOCK\]/);
  assert.match(output.hookSpecificOutput?.additionalContext ?? '', /Route: KPIUI\/KPIUI -> xigua-frontend-agent/);
  assert.match(output.hookSpecificOutput?.additionalContext ?? '', /Requirement sources: https:\/\/itxuqiu\.yuque\.com\//);
  assert.match(output.hookSpecificOutput?.additionalContext ?? '', /Forbidden: Xiaobai native page skills/);
});

test('Codex UserPromptSubmit hook blocks an empty payload inside Xiaobai', async () => {
  const result = await runPromptHook({});

  assert.equal(result.code, 2);
  assert.match(result.stderr, /\[XIGUA PRE-DISPATCH BLOCKED\]/);
  assert.match(result.stderr, /did not provide the current UserPromptSubmit prompt/);
  assert.equal(result.stdout, '');
});

test('Codex UserPromptSubmit hook blocks a cwd without the current prompt', async () => {
  const result = await runPromptHook({ cwd: repoRoot });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /did not provide the current UserPromptSubmit prompt/);
});

test('Codex UserPromptSubmit hook does not route a non-standard message alias', async () => {
  const result = await runPromptHook({ cwd: repoRoot, message: 'KPIUI 新增一个页面' });

  assert.equal(result.code, 2);
  assert.match(result.stderr, /did not provide the current UserPromptSubmit prompt/);
});

test('Codex UserPromptSubmit hook ignores projects outside Xiaobai', async () => {
  const externalRoot = await mkdtemp(path.join(tmpdir(), 'codex-hook-external-'));
  const result = await runPromptHook(
    {
      cwd: externalRoot,
      hook_event_name: 'UserPromptSubmit',
      prompt: '新增一个前端页面'
    },
    externalRoot
  );

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  await rm(externalRoot, { recursive: true, force: true });
});

async function runPromptHook(input: Record<string, unknown>, cwd = repoRoot): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [promptHookScript], {
      cwd,
      env: {
        ...process.env,
        XIAOBAI_PROJECT_ROOT: repoRoot
      },
      stdio: 'pipe'
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
    child.stdin.end(JSON.stringify(input));
  });
}

async function checkStale(cliPath: string, sourcePaths: string[]): Promise<boolean> {
  const moduleUrl = pathToFileURL(path.join(repoRoot, 'workspace/host/build-if-stale.mjs')).href;
  const script = `import { isBuildStale } from ${JSON.stringify(moduleUrl)};\n` +
    `process.stdout.write(String(isBuildStale(${JSON.stringify(cliPath)}, ${JSON.stringify(sourcePaths)})));`;
  const { stdout } = await execFileAsync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: repoRoot
  });
  return stdout.trim() === 'true';
}

test('Codex hook installer replaces legacy Xiaoneng entries without touching other hooks', async () => {
  const codexHome = await mkdtemp(path.join(tmpdir(), 'xiaobai-hook-install-'));
  const hooksPath = path.join(codexHome, 'hooks.json');
  await writeFile(
    hooksPath,
    JSON.stringify(
      {
        hooks: {
          UserPromptSubmit: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node /old/xiaoneng-codex-prompt-hook.mjs'
                }
              ]
            },
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node /old/xigua-codex-prompt-hook.mjs'
                }
              ]
            },
            {
              hooks: [
                {
                  type: 'command',
                  command: 'node /unrelated-hook.mjs'
                }
              ]
            }
          ]
        }
      },
      null,
      2
    ) + '\n',
    'utf8'
  );

  try {
    const { stdout } = await execFileAsync(process.execPath, [installerScript], {
      cwd: repoRoot,
      env: {
        ...process.env,
        CODEX_HOME: codexHome,
        XIAOBAI_PROJECT_ROOT: repoRoot
      }
    });
    assert.match(stdout, /Codex Xigua hook installed/);

    const config = JSON.parse(await readFile(hooksPath, 'utf8')) as {
      hooks: { UserPromptSubmit: Array<{ hooks: Array<{ command?: string }> }> };
    };
    const commands = config.hooks.UserPromptSubmit.flatMap((group) => group.hooks)
      .map((hook) => hook.command ?? '')
      .filter(Boolean);
    assert.equal(commands.filter((command) => command.includes('xigua-codex-prompt-hook.mjs')).length, 1);
    assert.equal(commands.some((command) => command.includes('xiaoneng-codex-prompt-hook.mjs')), false);
    assert.equal(commands.some((command) => command.includes('/unrelated-hook.mjs')), true);
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
