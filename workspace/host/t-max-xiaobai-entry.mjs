#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isXiaobaiProjectContext } from './xiaobai-host-scope.mjs';
import { ensureBuilt } from './build-if-stale.mjs';

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

// The host entry only forwards the raw request to Xiaobai under a trace id.
// It never selects xigua directly, reads dcm, or generates a page itself.
const traceId = randomUUID();
const receivedAt = new Date().toISOString();
const hostReceivedEvent = {
  event: 'dsh.request.received',
  detail: `hostCwd=${hostCwd}`,
  at: receivedAt
};

try {
  const build = ensureBuilt(xiaobaiRoot);
  if (!build.ok) {
    fail('XIAOBAI_ENTRY_UNAVAILABLE: Xiaobai engineering build failed before routing.');
  }

  const cliArgs = [
    path.join(xiaobaiRoot, 'dist/loop-engineering/cli/loop.js'),
    'route',
    '--workspace',
    'workspace',
    '--trace-id',
    traceId,
    '--target-cwd',
    targetCwd,
    '--json'
  ];
  if (args.message) cliArgs.push('--request-text', args.message);
  if (args.repository) cliArgs.push('--target-repository', args.repository);

  const raw = execFileSync(process.execPath, cliArgs, {
    cwd: xiaobaiRoot,
    encoding: 'utf8',
    stdio: ['inherit', 'pipe', 'inherit']
  });

  const route = JSON.parse(raw);
  // Prove the full order under one trace id: host received -> Xiaobai entry
  // -> project route -> executor dispatch. Missing xiaobai.entry.invoked here
  // means the Xiaobai entry was never proven for this request.
  route.trace = {
    traceId,
    events: [hostReceivedEvent, ...(route.trace?.events ?? [])]
  };
  if (route.trace.events[1]?.event !== 'xiaobai.entry.invoked') {
    fail('XIAOBAI_ENTRY_UNAVAILABLE: xiaobai.entry.invoked could not be proven for this request.');
  }

  process.stdout.write(`${JSON.stringify(route, null, 2)}\n`);
} catch (error) {
  if (error instanceof SyntaxError) {
    fail('XIAOBAI_ENTRY_UNAVAILABLE: Xiaobai route CLI returned invalid JSON.');
  }
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
