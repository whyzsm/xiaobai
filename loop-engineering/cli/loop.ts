#!/usr/bin/env node
import path from 'node:path';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { findLoopSpec, formatJson } from '../packages/shared/src/fs';
import { validateWorkspace } from '../packages/shared/src/validation';

interface CliOptions {
  command: string;
  workspace: string;
  loop?: string;
  json: boolean;
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const workspaceRoot = path.resolve(process.cwd(), options.workspace);
  const loopPath = await findLoopSpec(workspaceRoot, options.loop);

  if (options.command === 'validate') {
    const result = await validateWorkspace(workspaceRoot, loopPath);
    if (options.json) {
      process.stdout.write(formatJson(result));
    } else if (result.ok) {
      process.stdout.write(`OK: ${path.relative(process.cwd(), loopPath)}\n`);
    } else {
      process.stderr.write(`Validation failed:\n${result.errors.map((error) => `- ${error}`).join('\n')}\n`);
    }
    process.exitCode = result.ok ? 0 : 1;
    return;
  }

  if (options.command === 'dry-run') {
    const validation = await validateWorkspace(workspaceRoot, loopPath);
    if (!validation.ok) {
      process.stderr.write(`Validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }

    const runtime = new LoopRuntime();
    const plan = await runtime.dryRun({ workspaceRoot, loopPath });
    if (options.json) {
      process.stdout.write(formatJson(plan));
    } else {
      printPlan(plan);
    }
    return;
  }

  printHelp();
  process.exitCode = 1;
}

function parseArgs(argv: string[]): CliOptions {
  const [command = 'help', ...rest] = argv;
  const options: CliOptions = {
    command,
    workspace: 'workspace',
    json: false
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--workspace') {
      options.workspace = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--loop') {
      options.loop = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printPlan(plan: Awaited<ReturnType<LoopRuntime['dryRun']>>): void {
  process.stdout.write(`Loop: ${plan.loopId}\n`);
  process.stdout.write(`Schedule: ${plan.schedule.type} ${plan.schedule.expression} (${plan.schedule.timezone})\n`);
  process.stdout.write(`Budget: ${plan.budget.ok ? 'ok' : plan.budget.reasons.join(', ')}\n`);
  process.stdout.write(`Context: ${plan.context.evidenceSources} evidence sources, ${plan.context.skillPath}\n`);
  process.stdout.write(`Findings: ${plan.findings.length}\n`);
  for (const finding of plan.findings) {
    process.stdout.write(`- ${finding.id}: ${finding.title} [${finding.riskLevel}]\n`);
  }
  process.stdout.write(`Generator runs: ${plan.generatorRuns.length}\n`);
  process.stdout.write(`Evaluator runs: ${plan.evaluations.length}\n`);
  process.stdout.write(`Memory writes: ${plan.persistence.plannedWrites.join(', ')}\n`);
}

function printHelp(): void {
  process.stdout.write(`Usage:
  loop validate [--workspace workspace] [--loop morning-triage] [--json]
  loop dry-run  [--workspace workspace] [--loop morning-triage] [--json]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
