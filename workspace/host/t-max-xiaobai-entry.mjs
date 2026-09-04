#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isXiaobaiProjectContext } from './xiaobai-host-scope.mjs';

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const xiaobaiRoot = path.resolve(process.env.XIAOBAI_PROJECT_ROOT || path.join(hostDir, '../..'));
const args = parseArgs(process.argv.slice(2));
const targetCwd = path.resolve(args.cwd || process.cwd());
const hostCwd = args.hostCwd ? path.resolve(args.hostCwd) : undefined;

if (!hostCwd) {
  fail('T-MAX host routing requires --host-cwd inside the Xiaobai engineering repository.');
}

if (!(await isXiaobaiProjectContext(xiaobaiRoot, hostCwd))) {
  process.stdout.write('NO_ROUTE: the current conversation is outside the Xiaobai engineering repository.\n');
  process.exit(0);
}

if (!args.message && !args.repository && !args.cwd) {
  fail('T-MAX host routing needs the raw user message or a business-repository working directory.');
}

try {
  execFileSync('npm', ['run', 'build', '--silent'], {
    cwd: xiaobaiRoot,
    stdio: 'inherit'
  });

  const cliArgs = [
    path.join(xiaobaiRoot, 'dist/loop-engineering/cli/loop.js'),
    'route',
    '--workspace',
    'workspace',
    '--target-cwd',
    targetCwd,
    '--json'
  ];
  if (args.message) cliArgs.push('--request-text', args.message);
  if (args.repository) cliArgs.push('--target-repository', args.repository);
  if (args.mode) cliArgs.push('--xiaoneng-execution-mode', args.mode);

  execFileSync(process.execPath, cliArgs, {
    cwd: xiaobaiRoot,
    stdio: 'inherit'
  });
} catch (error) {
  const status = typeof error?.status === 'number' ? error.status : 1;
  process.exit(status);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd' || arg === '--host-cwd' || arg === '--message' || arg === '--repository' || arg === '--mode') {
      const value = argv[index + 1];
      if (!value) fail(`${arg} requires a value.`);
      result[arg === '--host-cwd' ? 'hostCwd' : arg.slice(2)] = value;
      index += 1;
    } else {
      fail(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}
