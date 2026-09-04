#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isXiaobaiProjectContext } from './xiaobai-host-scope.mjs';

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.env.XIAOBAI_PROJECT_ROOT || path.join(hostDir, '../..'));
const input = await readHookInput();
const rawTargetCwd = firstString(input.cwd);
if (!rawTargetCwd) process.exit(0);

const targetCwd = path.resolve(rawTargetCwd);
const requestText = firstString(input.prompt, input.userPrompt, input.message);

// This is a user-level hook, but its routing authority is limited to the Xiaobai
// engineering checkout that installed it. Every external project/repository
// belongs to its own host and must not be bridged through Xiaobai.
if (!(await isXiaobaiProjectContext(projectRoot, targetCwd))) process.exit(0);

const route = resolveRoute({ projectRoot, targetCwd, requestText });

if (route.status === 'not-applicable') process.exit(0);

if (route.status === 'blocked') {
  process.stdout.write([
    '[XIAONENG PRE-DISPATCH BLOCKED]',
    'The T-MAX route could not be verified before this user turn.',
    `Reason: ${route.reason}`,
    'Do not answer the business request, read page skills, or modify files.',
    'Stop and report XIAONENG_CONTEXT_INCOMPLETE.'
  ].join('\n') + '\n');
  process.exit(0);
}

const xiaoneng = route.result.xiaoneng;
if (!xiaoneng) {
  process.stdout.write([
    '[XIAONENG PRE-DISPATCH BLOCKED]',
    'The T-MAX project resolved without a Xiaoneng runtime handoff.',
    'Do not answer the business request or fall back to Xiaobai.',
    'Stop and report XIAONENG_CONTEXT_INCOMPLETE.'
  ].join('\n') + '\n');
  process.exit(0);
}

process.stdout.write([
  '[XIAONENG PRE-DISPATCH LOCK]',
  'This evidence was produced by the user-prompt hook before the assistant processed the request.',
  'Treat it as the mandatory top-level route for this turn.',
  `Route: ${xiaonengRoute(route.result)}`,
  `Target cwd: ${targetCwd}`,
  `Target repository root: ${route.result.targetRepository.mount}`,
  `Xiaoneng source root: ${xiaoneng.sourceConsumption.sourceRoot}`,
  `Manifest: ${path.resolve(xiaoneng.sourceConsumption.sourceRoot, xiaoneng.manifestPath)}`,
  `Entry: ${path.resolve(xiaoneng.sourceConsumption.sourceRoot, xiaoneng.entryPath)}`,
  `Mode: ${xiaoneng.executionMode}`,
  `Owner: ${xiaoneng.ownerAgent}`,
  `Skills: ${xiaoneng.ownerSkills.join(', ')}`,
  `Context digest: ${xiaoneng.contextDigest}`,
  `Source consumption: ${xiaoneng.sourceConsumption.files.length} files, consumer=${xiaoneng.sourceConsumption.consumedBy}`,
  'Required next action: continue this turn as the xiaoneng-agent top-level role using the mounted source files above.',
  'Forbidden before handoff: any user-level installed Skill source, direct frontend-generator, sa-page-plan, global page skills, or direct business-file analysis.',
  'If any required source or handoff evidence is missing, stop with XIAONENG_CONTEXT_INCOMPLETE.'
].join('\n') + '\n');

function resolveRoute({ projectRoot, targetCwd, requestText }) {
  const cliPath = path.join(projectRoot, 'dist/loop-engineering/cli/loop.js');
  if (!existsSync(cliPath)) {
    const build = spawnSync('npm', ['run', 'build', '--silent'], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe'
    });
    if (build.status !== 0) {
      return { status: 'blocked', reason: 'Xiaobai route CLI is not built and the engineering build failed.' };
    }
  }

  const args = [
    cliPath,
    'route',
    '--workspace',
    'workspace',
    '--target-cwd',
    targetCwd,
    '--json'
  ];
  if (requestText) args.push('--request-text', requestText);

  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (result.status === 0) {
    try {
      const parsed = JSON.parse(result.stdout);
      return parsed.project?.id === 't-max'
        ? { status: 'matched', result: parsed }
        : { status: 'not-applicable' };
    } catch {
      return { status: 'blocked', reason: 'Xiaobai route CLI returned invalid JSON.' };
    }
  }

  // A route failure that means "no T-MAX target could be determined at all"
  // (benign chit-chat, engineering-repo dev chat, or a cwd that is not a
  // mapped business repository) is silently skipped. Only a failure where a
  // T-MAX project WAS identified but its handoff could not be verified should
  // block the turn (per README: "a failed route must stop").
  if (/requires a target project or repository|not mapped to any project|no (target|repository) (?:is |was )?mapped/i.test(result.stderr || '')) {
    return { status: 'not-applicable' };
  }
  return { status: 'blocked', reason: 'Xiaobai route CLI failed to resolve the current T-MAX context.' };
}

function xiaonengRoute(result) {
  return `${result.project.id}/${result.targetRepository.id} -> ${result.xiaoneng.agentId}`;
}

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || '';
}

async function readHookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
