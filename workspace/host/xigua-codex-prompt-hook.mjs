#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isXiaobaiProjectContext } from './xiaobai-host-scope.mjs';
import { isBuildStale } from './build-if-stale.mjs';
import { classifyRequest } from './request-intent.mjs';

const hostDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(process.env.XIAOBAI_PROJECT_ROOT || path.join(hostDir, '../..'));
const input = parseCommandLineInput(process.argv.slice(2)) ?? await readHookInput();
const rawTargetCwd = firstString(
  input.cwd,
  process.cwd()
);

const targetCwd = path.resolve(rawTargetCwd);
const requestText = firstString(input.prompt);

// This is a user-level hook, but its routing authority is limited to the Xiaobai
// engineering checkout that installed it. Every external project/repository
// belongs to its own host and must not be bridged through Xiaobai.
if (!(await isXiaobaiProjectContext(projectRoot, targetCwd))) process.exit(0);

// Codex's UserPromptSubmit payload is the only trustworthy source for the
// current request. A missing prompt must stop the turn instead of routing an
// unrelated message from a stale transcript or another session.
if (!requestText) {
  blockRoute('Codex did not provide the current UserPromptSubmit prompt or it was empty.');
}

// Ordinary conversation must never depend on the engineering route build. The
// classifier reads only xigua project metadata and the current prompt.
const intent = await classifyRequest({
  projectRoot,
  targetCwd,
  requestText
});
if (intent.decision !== 'route-required') process.exit(0);

const route = await resolveRoute({
  projectRoot,
  targetCwd,
  requestText,
  targetProject: intent.targetProject
});

if (route.status === 'not-applicable') process.exit(0);

if (route.status === 'blocked') {
  blockRoute(route.reason);
}

if (route.result.executor === 'xigua') {
  if (!route.result.xigua) {
    blockRoute(
      'The standalone project resolved without a complete Xigua handoff. Do not fall back to Xiaobai.'
    );
  }

  const xigua = route.result.xigua;
  const additionalContext = [
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
    `Source fingerprint: ${xigua.sourceFingerprint}`,
    `Source worktree: ${xigua.sourceDirty ? 'dirty' : 'clean'}`,
    `Requirement sources: ${xigua.requirementIntake.requirementSources.join(', ') || '(none)'}`,
    `Trace: ${route.result.trace?.traceId ?? 'unavailable'}`,
    'Required next action: continue this turn as the xigua-frontend-agent top-level role using the mounted source above.',
    'Forbidden: Xiaobai native page skills, frontend-generator, silent fallback, or reading repositories outside the routed project scope.',
    'If any required source or handoff evidence is missing, stop with XIGUA_CONTEXT_INCOMPLETE.'
  ].join('\n');
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext
    }
  }) + '\n');
  process.exit(0);
}

blockRoute('The resolved route is not a Xigua standalone project.');

async function resolveRoute({ projectRoot, targetCwd, requestText, targetProject }) {
  const cliPath = path.join(projectRoot, 'dist/loop-engineering/cli/loop.js');
  const sourcePaths = [
    path.join(projectRoot, 'loop-engineering/cli'),
    path.join(projectRoot, 'loop-engineering/packages'),
    path.join(projectRoot, 'tsconfig.json')
  ];
  // UserPromptSubmit is on the interactive hot path. Never compile the
  // engineering repository here; setup/installation owns that lifecycle.
  if (!existsSync(cliPath)) {
    return {
      status: 'blocked',
      reason: 'Xiaobai route CLI is missing. Run npm run setup:codex before submitting a routed request.'
    };
  }
  if (isBuildStale(cliPath, sourcePaths)) {
    return {
      status: 'blocked',
      reason: 'Xiaobai route CLI is stale. Run npm run setup:codex before submitting a routed request.'
    };
  }

  const args = [
    cliPath,
    'route',
    '--workspace',
    'workspace',
    '--trace-id',
    hostTraceId(),
    '--target-project',
    targetProject,
    '--json'
  ];
  if (requestText) args.push('--request-text', requestText);

  const result = spawnSync(process.execPath, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: 'pipe',
    timeout: 8000
  });
  if (result.error) {
    return {
      status: 'blocked',
      reason: result.error.code === 'ETIMEDOUT'
        ? 'Xiaobai route CLI timed out before the xigua handoff was verified.'
        : 'Xiaobai route CLI could not be executed.'
    };
  }
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

function blockRoute(reason) {
  process.stderr.write([
    '[XIGUA PRE-DISPATCH BLOCKED]',
    'The current Codex turn is blocked before assistant processing.',
    `Reason: ${reason}`,
    'Do not answer the business request, read page skills, or modify files.',
    'Stop and report XIGUA_CONTEXT_INCOMPLETE.'
  ].join('\n') + '\n');
  process.exit(2);
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

// Desktop fallback mode passes the current prompt explicitly when the host did
// not inject the UserPromptSubmit hook. The normal hook path still reads the
// Codex JSON payload from stdin.
function parseCommandLineInput(args) {
  if (args.length === 0) return null;

  const input = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== '--cwd' && flag !== '--prompt') {
      blockRoute(`Unsupported direct-route argument: ${flag}`);
    }
    const value = args[index + 1];
    if (!value) blockRoute(`${flag} requires a value.`);
    input[flag === '--cwd' ? 'cwd' : 'prompt'] = value;
    index += 1;
  }
  return input;
}
