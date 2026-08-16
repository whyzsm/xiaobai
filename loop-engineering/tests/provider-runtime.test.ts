import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { PromptRuntime } from '../packages/prompt-runtime/src/promptRuntime';
import {
  claudeManagedProfileId,
  clientSubmissionProfileId,
  codexReadOnlyProfileId,
  codexWritableProfileId,
  geminiManagedProfileId,
  normalizeProviderRuntimeEvent,
  parseProviderRunResult,
  ProviderRuntime,
  validateProviderCanHandle,
  validateProviderWorkspaceGuard,
  workbuddyClientProfileId,
  zcodeClientProfileId
} from '../packages/provider-runtime/src/providerRuntime';
import { ClaudeCodeAdapter } from '../packages/execution-runtime/src/claudeCodeAdapter';
import { CodexCliAdapter } from '../packages/execution-runtime/src/codexCliAdapter';
import { GeminiCliAdapter } from '../packages/execution-runtime/src/geminiCliAdapter';
import { WorktreeManager } from '../packages/worktree-manager/src/worktreeManager';
import {
  ExecutorAdapter,
  ExecutorAdapterInput,
  ExecutorAdapterResult,
  HarnessSpec,
  JsonRecord,
  LoopSpec,
  ResolvedBackgroundContext,
  TaskEnvelope,
  WorkspaceLease,
  WorkflowStagePlan
} from '../packages/shared/src/types';

const execFileAsync = promisify(execFile);

test('prompt runtime assembles deterministic provider-neutral payloads with background metadata', () => {
  const runtime = new PromptRuntime();
  const first = runtime.assemble({
    task: taskFixture({ subject: { title: 'A' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });
  const second = runtime.assemble({
    task: taskFixture({ subject: { title: 'A' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });
  const changed = runtime.assemble({
    task: taskFixture({ subject: { title: 'B' } }),
    stage: stageFixture(),
    harness: harnessFixture(),
    outputSchema: { type: 'object' },
    backgroundContext: backgroundFixture()
  });

  assert.equal(first.promptDigest, second.promptDigest);
  assert.notEqual(first.promptDigest, changed.promptDigest);
  assert.match(first.prompt, /xiaobai-provider-prompt-v1/);
  assert.equal(
    (first.payload.backgroundContext as { contextDigest: string }).contextDigest,
    'b'.repeat(64)
  );
});

test('provider runtime selects default read-only Codex profile and blocks writable actions', () => {
  const runtime = new ProviderRuntime();
  const profile = runtime.selectProfile({ requestedActions: ['read'] });

  assert.equal(profile.id, codexReadOnlyProfileId);
  assert.equal(profile.writable, false);
  assert.deepEqual(validateProviderCanHandle(profile, ['read']), []);
  assert.match(validateProviderCanHandle(profile, ['write']).join('\n'), /read-only/);
  assert.throws(() => runtime.selectProfile({ requestedActions: ['write'] }), /capability mismatch/);
});

test('provider runtime exposes writable Codex profile and validates lease scoped cwd', () => {
  const runtime = new ProviderRuntime();
  const profile = runtime.requireProfile(codexWritableProfileId);
  const lease = leaseFixture();

  assert.equal(profile.writable, true);
  assert.deepEqual(validateProviderCanHandle(profile, ['write']), []);
  assert.deepEqual(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      workspaceLease: lease,
      cwd: '/tmp/worktrees/task-1/src'
    }),
    []
  );
  assert.match(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      cwd: '/tmp/worktrees/task-1'
    }).join('\n'),
    /workspace lease/
  );
  assert.match(
    validateProviderWorkspaceGuard({
      profile,
      requestedActions: ['write'],
      workspaceLease: lease,
      cwd: '/tmp/other'
    }).join('\n'),
    /lease path/
  );
});

test('provider registry records support levels without over-claiming external tools', () => {
  const runtime = new ProviderRuntime();
  const support = new Map(runtime.listProfiles().map((profile) => [profile.id, profile.supportLevel]));

  assert.equal(support.get(codexReadOnlyProfileId), 'supported');
  assert.equal(support.get(codexWritableProfileId), 'experimental');
  assert.equal(support.get(claudeManagedProfileId), 'experimental');
  assert.equal(support.get(geminiManagedProfileId), 'experimental');
  assert.equal(support.get(clientSubmissionProfileId), 'client_only');
  assert.equal(support.get(zcodeClientProfileId), 'client_only');
  assert.equal(support.get(workbuddyClientProfileId), 'client_only');
});

test('provider runtime creates adapters through registered factories', () => {
  const runtime = new ProviderRuntime();
  const selected = runtime.createExecutorAdapter({
    requestedActions: ['read'],
    factories: {
      [codexReadOnlyProfileId]: () => new DummyAdapter()
    }
  });

  assert.equal(selected.profile.id, codexReadOnlyProfileId);
  assert.equal(selected.adapter.id, 'dummy');
});

test('provider runtime normalizes provider events into executor reported events', () => {
  const event = normalizeProviderRuntimeEvent({
    eventType: 'model/requested',
    providerProfileId: codexReadOnlyProfileId,
    taskId: 'task-1',
    data: { requestId: 'run:task:stage:1' },
    evidence: [{ type: 'command', value: 'codex exec' }]
  });

  assert.equal(event.eventType, 'model/requested');
  assert.equal(event.data.providerProfileId, codexReadOnlyProfileId);
  assert.equal(event.data.taskId, 'task-1');
  assert.equal(event.data.requestId, 'run:task:stage:1');
  assert.equal(event.evidence?.[0].type, 'command');
});

test('provider runtime parses provider run result change summaries', () => {
  const result = parseProviderRunResult({
    taskId: 'task-1',
    providerProfileId: codexWritableProfileId,
    status: 'completed',
    startedAt: '2026-08-15T00:00:00.000Z',
    finishedAt: '2026-08-15T00:01:00.000Z',
    output: {
      changedFiles: ['src/example.ts'],
      diffSummary: 'updated example',
      verificationCommands: ['npm run build']
    },
    evidence: [{ type: 'diff', value: 'src/example.ts changed' }]
  });

  assert.deepEqual(result.changedFiles, ['src/example.ts']);
  assert.equal(result.diffSummary, 'updated example');
  assert.deepEqual(result.verificationCommands, ['npm run build']);
});

test('writable Codex adapter blocks before process launch without an explicit worktree path', async () => {
  const adapter = new CodexCliAdapter({ sandbox: 'workspace-write', executable: 'definitely-not-called' });
  const result = await adapter.execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: {
      id: 'implementation',
      kind: 'coding',
      status: 'planned',
      gate: 'automatic',
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml',
      dependsOn: [],
      requiredChecks: [],
      requiredGates: [],
      requiredBefore: [],
      outputs: []
    },
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot: process.cwd()
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason ?? '', /missing_workspace_lease/);
});

test('writable Codex adapter sends prompt through stdin and keeps argv prompt-free', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-stdin-success-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  const payload = harnessSubmissionPayload();
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, cwd: process.cwd(), prompt }));
if (args.at(-1) !== '-') process.exit(23);
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(payload)}));
process.stdout.write(JSON.stringify({ type: 'item.completed' }) + '\\n');
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({
    sandbox: 'workspace-write',
    executable,
    now: () => new Date('2026-08-16T00:00:00.000Z')
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: { title: 'make a small edit' },
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { args: string[]; cwd: string; prompt: string };
  assert.equal(audit.args.at(-1), '-');
  assert.equal(audit.args.includes('make a small edit'), false);
  assert.match(audit.prompt, /make a small edit/);
  assert.equal(await realpath(audit.cwd), await realpath(worktreePath));
});

test('Codex adapter can opt into the local user config for custom providers', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-user-config-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
for await (const _chunk of process.stdin) {}
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args }));
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(harnessSubmissionPayload())}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({
    sandbox: 'workspace-write',
    executable,
    ignoreUserConfig: false
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { args: string[] };
  assert.equal(audit.args.includes('--ignore-user-config'), false);
});

test('Codex adapter can disable CLI output schema for OpenAI-compatible relays', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-no-output-schema-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, prompt }));
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify(harnessSubmissionPayload())}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({
    sandbox: 'workspace-write',
    executable,
    useOutputSchema: false
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { args: string[]; prompt: string };
  assert.equal(audit.args.includes('--output-schema'), false);
  assert.equal(audit.args.includes('--output-last-message'), true);
  assert.match(audit.prompt, /output-schema-json/);
});

test('writable Codex adapter edits a claimed git worktree lease without push or merge authority', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-lease-fixture-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const repositoryPath = path.join(tempRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.mjs');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(repositoryPath, { recursive: true });
  await execFileAsync('git', ['init', '-q'], { cwd: repositoryPath });
  await writeFile(path.join(repositoryPath, 'README.md'), 'initial\n', 'utf8');
  await execFileAsync('git', ['add', 'README.md'], { cwd: repositoryPath });
  await execFileAsync(
    'git',
    ['-c', 'user.name=Loop Test', '-c', 'user.email=loop-test@example.com', 'commit', '-q', '-m', 'initial'],
    { cwd: repositoryPath }
  );
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');

  const manager = new WorktreeManager(workspaceRoot, leaseLoopFixture(), 't-max');
  const prepared = await manager.prepare({
    taskId: 'codex-smoke',
    repositoryId: 'operateBusiness',
    repositoryPath,
    now: new Date('2026-08-16T00:00:00.000Z')
  });
  const claimed = await manager.claim({
    leaseId: prepared.leaseId,
    ownerId: 'codex',
    providerProfileId: codexWritableProfileId,
    now: new Date('2026-08-16T00:01:00.000Z')
  });
  const active = await manager.heartbeat(claimed.leaseId, new Date('2026-08-16T00:02:00.000Z'));

  await writeFile(
    executable,
    `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
for await (const _chunk of process.stdin) {}
appendFileSync('README.md', 'codex-leased-ok\\n');
writeFileSync(option('--output-last-message'), JSON.stringify(${JSON.stringify({
      ...harnessSubmissionPayload(),
      output: {
        changedFiles: ['README.md'],
        diffSummary: 'Appended codex-leased-ok to README.md inside the claimed lease worktree.',
        verificationCommands: ['grep -Fx codex-leased-ok README.md']
      },
      evidence: [{ checkId: 'codex-lease-edit', type: 'diff', value: 'README.md contains codex-leased-ok' }]
    })}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({
    sandbox: 'workspace-write',
    executable
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'codex-smoke',
    stage: codingStageFixture(),
    attempt: 1,
    actions: ['write'],
    subject: { title: 'append lease smoke marker' },
    workspaceRoot,
    worktreePath: path.relative(workspaceRoot, active.path)
  });

  assert.equal(result.status, 'completed');
  assert.match(await readFile(path.join(active.path, 'README.md'), 'utf8'), /codex-leased-ok/);
  const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: active.path });
  assert.match(status.stdout, /README\.md/);
  assert.equal((await manager.currentLease(active.leaseId))?.owner?.providerProfileId, codexWritableProfileId);

  const pushAttempt = await new CodexCliAdapter({
    sandbox: 'workspace-write',
    executable: path.join(tempRoot, 'definitely-not-called')
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'codex-smoke',
    stage: codingStageFixture(),
    attempt: 1,
    actions: ['push', 'merge'],
    subject: { title: 'try unauthorized remote mutation' },
    workspaceRoot,
    worktreePath: path.relative(workspaceRoot, active.path)
  });

  assert.equal(pushAttempt.status, 'blocked');
  assert.match(pushAttempt.reason ?? '', /unsupported_mutation_stage/);
  assert.match(pushAttempt.reason ?? '', /push, merge|merge, push/);
});

test('Codex adapter reports JSONL turn failures when no last message is produced', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'codex-jsonl-failure-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-codex.js');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
console.log(JSON.stringify({
  type: 'turn.failed',
  error: { message: 'unexpected status 401 Unauthorized: Incorrect API key provided: sk-1234567890abcdef' }
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new CodexCliAdapter({ sandbox: 'workspace-write', executable }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /codex_cli_failed/);
  assert.match(result.reason ?? '', /sk-<redacted>/);
});

test('Claude managed adapter blocks before process launch without an explicit worktree path', async () => {
  const adapter = new ClaudeCodeAdapter({ executable: 'definitely-not-called' });
  const result = await adapter.execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot: process.cwd()
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason ?? '', /missing_workspace_lease/);
});

test('Claude managed adapter parses structured JSON results from stdout', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-json-success-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-claude.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  const payload = harnessSubmissionPayload();
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, cwd: process.cwd(), prompt }));
process.stdout.write(JSON.stringify({
  type: 'result',
  is_error: false,
  result: JSON.stringify(${JSON.stringify(payload)})
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new ClaudeCodeAdapter({
    executable,
    now: () => new Date('2026-08-16T00:00:00.000Z')
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: { title: 'make a Claude edit' },
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  const submission = result.submission as { runId: string; taskId: string; agentId: string; harnessId: string };
  assert.equal(submission.runId, 'run');
  assert.equal(submission.taskId, 'task');
  assert.equal(submission.agentId, 'generator');
  assert.equal(submission.harnessId, 'coding-harness');

  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { args: string[]; cwd: string; prompt: string };
  assert.deepEqual(audit.args.slice(0, 3), ['-p', '--output-format', 'json']);
  assert.equal(audit.args.includes('--json-schema'), true);
  assert.equal(audit.args[audit.args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.equal(audit.args[audit.args.indexOf('--allowedTools') + 1], 'Read,Edit');
  assert.equal(audit.args.includes('make a Claude edit'), false);
  assert.match(audit.prompt, /make a Claude edit/);
  assert.equal(await realpath(audit.cwd), await realpath(worktreePath));
});

test('Claude managed adapter reads Claude Code structured_output when result is narrative text', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-structured-output-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-claude.mjs');
  const payload = harnessSubmissionPayload();
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  type: 'result',
  is_error: false,
  result: 'Done. Appended the requested line.',
  structured_output: ${JSON.stringify(payload)}
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new ClaudeCodeAdapter({ executable }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: { title: 'make a Claude edit' },
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual((result.submission as JsonRecord).output, payload.output);
});

test('Claude managed adapter reports CLI failure envelopes without leaking API keys', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-json-failure-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-claude.mjs');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  type: 'result',
  is_error: true,
  subtype: 'aborted_streaming',
  terminal_reason: 'aborted_streaming',
  errors: ['Incorrect API key provided: sk-1234567890abcdef']
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new ClaudeCodeAdapter({ executable }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /claude_cli_failed/);
  assert.match(result.reason ?? '', /aborted_streaming/);
  assert.match(result.reason ?? '', /sk-<redacted>/);
});

test('Claude managed adapter summarizes debug API errors when the CLI times out', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'claude-debug-timeout-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-claude.mjs');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const option = (name) => args[args.indexOf(name) + 1];
writeFileSync(option('--debug-file'), '2026-08-16T00:00:00.000Z [ERROR] API error (attempt 1/11): 401 401 {"error":{"message":"身份验证失败。","api_key":"sk-1234567890abcdef"}}\\n');
setInterval(() => {}, 1000);
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new ClaudeCodeAdapter({ executable, timeoutMs: 1000 }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /claude_cli_failed/);
  assert.match(result.reason ?? '', /401/);
  assert.match(result.reason ?? '', /身份验证失败/);
  assert.match(result.reason ?? '', /sk-<redacted>/);
});

test('Gemini managed adapter blocks before process launch without an explicit worktree path', async () => {
  const adapter = new GeminiCliAdapter({ executable: 'definitely-not-called' });
  const result = await adapter.execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot: process.cwd()
  });

  assert.equal(result.status, 'blocked');
  assert.match(result.reason ?? '', /missing_workspace_lease/);
});

test('Gemini managed adapter parses JSON output response fields from stdout', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'gemini-json-success-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-gemini.mjs');
  const auditPath = path.join(tempRoot, 'audit.json');
  const payload = harnessSubmissionPayload();
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
let prompt = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) prompt += chunk;
writeFileSync(${JSON.stringify(auditPath)}, JSON.stringify({ args, cwd: process.cwd(), prompt }));
process.stdout.write(JSON.stringify({
  response: JSON.stringify(${JSON.stringify(payload)}),
  stats: { models: ['gemini-fixture'] }
}));
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new GeminiCliAdapter({
    executable,
    now: () => new Date('2026-08-16T00:00:00.000Z')
  }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: { title: 'make a Gemini edit' },
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'completed');
  assert.equal((result.submission as JsonRecord).agentId, 'generator');
  assert.deepEqual((result.submission as JsonRecord).output, payload.output);

  const audit = JSON.parse(await readFile(auditPath, 'utf8')) as { args: string[]; cwd: string; prompt: string };
  assert.deepEqual(audit.args.slice(0, 4), [
    '-p',
    'Read the complete task instructions from stdin. Return only the requested JSON object.',
    '--output-format',
    'json'
  ]);
  assert.equal(audit.args.includes('--skip-trust'), true);
  assert.equal(audit.args[audit.args.indexOf('--approval-mode') + 1], 'auto_edit');
  assert.equal(audit.args.includes('make a Gemini edit'), false);
  assert.match(audit.prompt, /make a Gemini edit/);
  assert.equal(await realpath(audit.cwd), await realpath(worktreePath));
});

test('Gemini managed adapter reports timeouts without leaking secrets', async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'gemini-timeout-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const worktreePath = path.join(workspaceRoot, 'repo');
  const executable = path.join(tempRoot, 'fake-gemini.mjs');
  await mkdir(path.join(workspaceRoot, 'agents'), { recursive: true });
  await mkdir(worktreePath, { recursive: true });
  await writeFile(path.join(workspaceRoot, 'agents', 'coding.harness.yaml'), harnessYamlFixture(), 'utf8');
  await writeFile(
    executable,
    `#!/usr/bin/env node
process.stderr.write('using api key AIza1234567890abcdefghijklmnop\\n');
setInterval(() => {}, 1000);
`,
    'utf8'
  );
  await chmod(executable, 0o755);

  const result = await new GeminiCliAdapter({ executable, timeoutMs: 500 }).execute({
    loopId: 'loop',
    runId: 'run',
    taskId: 'task',
    stage: codingStageFixture(),
    attempt: 1,
    actions: [],
    subject: {},
    workspaceRoot,
    worktreePath
  });

  assert.equal(result.status, 'failed');
  assert.match(result.reason ?? '', /gemini_cli_failed/);
  assert.match(result.reason ?? '', /ETIMEDOUT/);
  assert.doesNotMatch(result.reason ?? '', /AIza1234567890abcdefghijklmnop/);
  assert.match(result.reason ?? '', /AIza<redacted>/);
});

class DummyAdapter implements ExecutorAdapter {
  readonly id = 'dummy';

  async execute(_input: ExecutorAdapterInput): Promise<ExecutorAdapterResult> {
    return {
      status: 'completed',
      submission: {},
      evidence: []
    };
  }
}

function taskFixture(input: { subject: Record<string, unknown> }): TaskEnvelope {
  return {
    kind: 'TaskEnvelope',
    version: 1,
    taskId: 'task-1',
    state: 'prepared',
    entryPoint: 'cli',
    projectId: 't-max',
    subject: input.subject,
    requestedActions: ['read'],
    providerMode: 'managed',
    gateRequirements: [],
    events: [
      {
        kind: 'TaskEvent',
        version: 1,
        id: 'event-1',
        seq: 1,
        taskId: 'task-1',
        eventType: 'task/created',
        occurredAt: '2026-08-15T00:00:00.000Z',
        actor: 'runtime',
        state: 'created',
        data: {},
        evidence: []
      }
    ],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  };
}

function stageFixture(): WorkflowStagePlan {
  return {
    id: 'review',
    kind: 'review',
    status: 'planned',
    gate: 'automatic',
    evaluator: 'checker.agent.yaml',
    dependsOn: [],
    requiredChecks: ['reviewed'],
    requiredGates: [],
    requiredBefore: [],
    outputs: ['summary']
  };
}

function harnessFixture(): HarnessSpec {
  return {
    kind: 'Harness',
    version: 1,
    metadata: {
      id: 'review-harness'
    },
    tools: {
      allow: ['read_file'],
      deny: ['write_file']
    },
    context: {
      loaders: ['task'],
      maxCharacters: 1000
    },
    completion: {
      type: 'all',
      conditions: ['reviewed']
    },
    failure: {},
    output: {
      required: ['summary']
    }
  };
}

function harnessYamlFixture(): string {
  return `kind: Harness
version: 1
metadata:
  id: coding-harness
tools:
  allow:
    - read_file
  deny: []
context:
  loaders: []
  maxCharacters: 1000
completion:
  type: objective
  conditions: []
failure: {}
output:
  required: []
`;
}

function codingStageFixture(): WorkflowStagePlan {
  return {
    id: 'implementation',
    kind: 'coding',
    status: 'planned',
    gate: 'automatic',
    agent: 'generator.agent.yaml',
    harness: 'coding.harness.yaml',
    dependsOn: [],
    requiredChecks: [],
    requiredGates: [],
    requiredBefore: [],
    outputs: []
  };
}

function harnessSubmissionPayload(): JsonRecord {
  return {
    loadedContext: [],
    contextCharactersUsed: 0,
    toolsUsed: [],
    completedConditions: [],
    output: {
      changedFiles: ['README.md'],
      diffSummary: 'fixture edit',
      verificationCommands: ['npm run build']
    },
    evidence: []
  };
}

function leaseLoopFixture(): LoopSpec {
  return {
    kind: 'Loop',
    version: 1,
    metadata: {
      id: 'provider-certification',
      name: 'Provider Certification',
      owner: 'loop'
    },
    schedule: {
      type: 'manual',
      expression: 'manual',
      timezone: 'Asia/Shanghai'
    },
    discovery: {
      skill: 'provider-certification',
      sources: []
    },
    handoff: {
      strategy: 'worktree',
      project: 't-max',
      worktreeRoot: '.local/provider-certification/worktrees',
      branchTemplate: 'loop/provider-certification/{date}/{taskId}'
    },
    generator: {
      agent: 'generator.agent.yaml',
      harness: 'coding.harness.yaml'
    },
    verification: {
      evaluator: 'evaluator.agent.yaml',
      requiredChecks: [],
      allowSelfReview: false
    },
    persistence: {
      memory: {
        stateFile: 'state.md',
        inboxFile: 'inbox.md',
        runLog: 'runs.jsonl'
      },
      outputs: []
    },
    budget: {
      maxTokensPerRun: 1000,
      maxRetriesPerTask: 1,
      maxParallelTasks: 2
    },
    humanGate: {
      requiredBefore: [],
      reviewers: [],
      gates: []
    }
  };
}

function backgroundFixture(): ResolvedBackgroundContext {
  return {
    kind: 'skill-context',
    projectId: 't-max',
    backgroundId: 'xiaoneng',
    skillContext: {
      contractVersion: '1.0.0',
      skillId: 'xiaoneng-agent',
      skillCommit: 'a'.repeat(40),
      entryPath: 'xiaoneng-agent/SKILL.md',
      entryHash: 'a'.repeat(64),
      manifestPath: 'harness/runtime/manifest.yaml',
      manifestDigest: 'a'.repeat(64),
      executionMode: 'FullWorkflow',
      ownerAgent: 'xiaoneng-agent',
      ownerSkills: ['op-ship-ops'],
      selectedReferences: [],
      contextDigest: 'b'.repeat(64)
    },
    documents: [
      {
        roles: ['entry'],
        path: 'xiaoneng-agent/SKILL.md',
        sourceDigest: 'c'.repeat(64),
        contentDigest: 'd'.repeat(64),
        selection: 'full',
        content: 'background'
      }
    ],
    characters: 10
  };
}

function leaseFixture(): WorkspaceLease {
  return {
    kind: 'WorkspaceLease',
    version: 1,
    leaseId: 'lease-1',
    taskId: 'task-1',
    projectId: 't-max',
    repositoryId: 'operateBusiness',
    repositoryPath: '/tmp/repo',
    baseRef: 'main',
    branch: 'loop/task-1',
    path: '/tmp/worktrees/task-1',
    state: 'active',
    owner: {
      id: 'codex',
      role: 'writer',
      providerProfileId: codexWritableProfileId,
      claimedAt: '2026-08-15T00:00:00.000Z'
    },
    heartbeat: {
      intervalMs: 60000,
      lastSeenAt: '2026-08-15T00:00:00.000Z',
      expiresAt: '2026-08-15T00:02:00.000Z'
    },
    dirtyPolicy: 'retain_dirty',
    evidence: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z'
  };
}
