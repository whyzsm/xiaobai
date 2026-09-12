#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isXiaobaiProjectContext } from './xiaobai-host-scope.mjs';
import { ensureBuilt } from './build-if-stale.mjs';

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

const route = await resolveRoute({ projectRoot, targetCwd, requestText });

if (route.status === 'not-applicable') process.exit(0);

if (route.status === 'blocked') {
  process.stdout.write([
    '[XIGUA PRE-DISPATCH BLOCKED]',
    'The T-MAX route could not be verified before this user turn.',
    `Reason: ${route.reason}`,
    'Do not answer the business request, read page skills, or modify files.',
    'Stop and report XIGUA_CONTEXT_INCOMPLETE.'
  ].join('\n') + '\n');
  process.exit(0);
}

if (route.result.executor === 'xigua') {
  if (!route.result.xigua) {
    process.stdout.write([
      '[XIGUA PRE-DISPATCH BLOCKED]',
      'The standalone project resolved without a complete Xigua handoff.',
      'Do not answer the business request or fall back to Xiaobai.',
      'Stop and report XIGUA_CONTEXT_INCOMPLETE.'
    ].join('\n') + '\n');
    process.exit(0);
  }

  const xigua = route.result.xigua;
  process.stdout.write([
    '[XIGUA PRE-DISPATCH LOCK]',
    'This evidence was produced by the user-prompt hook before the assistant processed the request.',
    'Treat it as the mandatory top-level route for this turn.',
    `Route: ${route.result.project.id}/${route.result.targetRepository.id} -> ${xigua.agentId}`,
    `Target cwd: ${targetCwd}`,
    `Target repository root: ${route.result.targetRepository.mount}`,
    `Xigua source root: ${xigua.sourceConsumption.sourceRoot}`,
    `Entry: ${path.resolve(xigua.sourceConsumption.sourceRoot, xigua.entryPath)}`,
    `Entry hash: ${xigua.entryHash}`,
    `Source commit: ${xigua.sourceCommit}`,
    `Requirement sources: ${xigua.requirementIntake.requirementSources.join(', ') || '(none)'}`,
    `Trace: ${route.result.trace?.traceId ?? 'unavailable'}`,
    'Required next action: continue this turn as the xigua-frontend-agent top-level role using the mounted source above.',
    'Forbidden: Xiaobai native page skills, frontend-generator, silent fallback, or reading repositories outside the routed project scope.',
    'If any required source or handoff evidence is missing, stop with XIGUA_CONTEXT_INCOMPLETE.'
  ].join('\n') + '\n');
  process.exit(0);
}

process.stdout.write([
  '[XIGUA PRE-DISPATCH BLOCKED]',
  'The resolved route is not a Xigua standalone project.',
  'Stop and report XIGUA_CONTEXT_INCOMPLETE.'
].join('\n') + '\n');

async function resolveRoute({ projectRoot, targetCwd, requestText }) {
  const cliPath = path.join(projectRoot, 'dist/loop-engineering/cli/loop.js');
  // Rebuild when the CLI is missing OR stale (sources/tsconfig newer than the
  // compiled output), so a branch switch can never route on a foreign build.
  const build = ensureBuilt(projectRoot);
  if (!build.ok) {
    return { status: 'blocked', reason: 'Xiaobai route CLI is not built and the engineering build failed.' };
  }

  const args = [
    cliPath,
    'route',
    '--workspace',
    'workspace',
    '--trace-id',
    hostTraceId(),
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
      return parsed.executor === 'xigua'
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

function hostTraceId() {
  return `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
