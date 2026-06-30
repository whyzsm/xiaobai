#!/usr/bin/env node
import path from 'node:path';
import { readdir } from 'node:fs/promises';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, formatJson } from '../packages/shared/src/fs';
import { validateWorkspace } from '../packages/shared/src/validation';
import { runMemoryCommand } from './memory';

interface CliOptions {
  command: string;
  workspace: string;
  loop?: string;
  json: boolean;
  targetProject?: string;
  targetRepository?: string;
  targetCwd?: string;
  targetRemote?: string;
  rest: string[];
}

async function main(argv: string[]): Promise<void> {
  const options = parseArgs(argv);
  const workspaceRoot = path.resolve(process.cwd(), options.workspace);

  if (options.command === 'memory') {
    const [memoryCommand = 'help', ...memoryArgs] = options.rest;
    await runMemoryCommand({
      command: memoryCommand,
      args: memoryArgs,
      workspaceRoot,
      repoRoot: process.cwd()
    });
    return;
  }

  if (options.command === 'validate') {
    const loopPaths = options.loop ? [await findLoopSpec(workspaceRoot, options.loop)] : await listLoopSpecs(workspaceRoot);
    const results = await Promise.all(
      loopPaths.map(async (loopPath) => ({
        loopPath,
        result: await validateWorkspace(workspaceRoot, loopPath)
      }))
    );
    const allOk = results.every(({ result }) => result.ok);
    if (options.json) {
      process.stdout.write(formatJson(results));
    } else if (allOk) {
      process.stdout.write(results.map(({ loopPath }) => `OK: ${path.relative(process.cwd(), loopPath)}`).join('\n'));
      process.stdout.write('\n');
    } else {
      const errors = results.flatMap(({ loopPath, result }) =>
        result.errors.map((error) => `${path.relative(process.cwd(), loopPath)}: ${error}`)
      );
      process.stderr.write(`Validation failed:\n${errors.map((error) => `- ${error}`).join('\n')}\n`);
    }
    process.exitCode = allOk ? 0 : 1;
    return;
  }

  const loopPath = await findLoopSpec(workspaceRoot, options.loop);

  if (options.command === 'dry-run') {
    const validation = await validateWorkspace(workspaceRoot, loopPath);
    if (!validation.ok) {
      process.stderr.write(`Validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }

    const runtime = new LoopRuntime();
    const plan = await runtime.dryRun({
      workspaceRoot,
      loopPath,
      targetProject: options.targetProject,
      targetRepository: options.targetRepository,
      targetCwd: options.targetCwd,
      targetRemote: options.targetRemote
    });
    if (options.json) {
      process.stdout.write(formatJson(plan));
    } else {
      printPlan(plan);
    }
    return;
  }

  if (options.command === 'simulate') {
    const validation = await validateWorkspace(workspaceRoot, loopPath);
    if (!validation.ok) {
      process.stderr.write(`Validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }

    const runtime = new SimulationRuntime();
    const result = await runtime.simulate({ workspaceRoot, loopPath, repoRoot: process.cwd() });
    if (options.json) {
      process.stdout.write(formatJson(result));
    } else {
      printSimulation(result);
    }
    return;
  }

  printHelp();
  process.exitCode = 1;
}

async function listLoopSpecs(workspaceRoot: string): Promise<string[]> {
  const loopsDir = path.join(workspaceRoot, 'loops');
  const files = (await readdir(loopsDir)).filter((file) => file.endsWith('.loop.yaml')).sort();
  if (files.length === 0) {
    throw new Error(`No loop specs found in ${loopsDir}`);
  }
  return files.map((file) => path.join(loopsDir, file));
}

function parseArgs(argv: string[]): CliOptions {
  const [command = 'help', ...rest] = argv;
  const options: CliOptions = {
    command,
    workspace: 'workspace',
    json: false,
    rest: []
  };

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (command === 'memory') {
      if (arg === '--workspace') {
        options.workspace = requireValue(rest, index, arg);
        index += 1;
      } else {
        options.rest.push(arg);
      }
    } else if (arg === '--workspace') {
      options.workspace = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--loop') {
      options.loop = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-project') {
      options.targetProject = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-repository') {
      options.targetRepository = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-cwd') {
      options.targetCwd = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-remote') {
      options.targetRemote = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      options.rest.push(arg);
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
  if (plan.orchestrator) {
    const project = plan.orchestrator.routesTo.project;
    const resolvedTarget = project.resolution.matchedRepositoryId ?? project.resolution.target ?? project.projectId;
    process.stdout.write(`Orchestrator: ${plan.orchestrator.agentId} (${plan.orchestrator.agentFile})\n`);
    process.stdout.write(`Resolved target: ${resolvedTarget} -> ${project.projectId}`);
    if (project.background) {
      process.stdout.write(` -> ${project.background.id}`);
    }
    process.stdout.write('\n');
    process.stdout.write(`Route source: ${project.resolution.source}\n`);
    process.stdout.write(`Project route: ${project.projectId}`);
    if (project.background) {
      process.stdout.write(` -> ${project.background.id}`);
    }
    process.stdout.write(`, repositories: ${project.repositories.length}\n`);
  }
  process.stdout.write(`Context: ${plan.context.evidenceSources} evidence sources, ${plan.context.skillPath}\n`);
  process.stdout.write(`Findings: ${plan.findings.length}\n`);
  for (const finding of plan.findings) {
    process.stdout.write(`- ${finding.id}: ${finding.title} [${finding.riskLevel}]\n`);
  }
  process.stdout.write(`Generator runs: ${plan.generatorRuns.length}\n`);
  process.stdout.write(`Evaluator runs: ${plan.evaluations.length}\n`);
  if (plan.workflow) {
    process.stdout.write(`Workflow stages: ${plan.workflow.stages.length}\n`);
    for (const stage of plan.workflow.stages) {
      process.stdout.write(`- ${stage.id} [${stage.kind}, ${stage.gate}, ${stage.status}]\n`);
    }
  }
  process.stdout.write(`Memory writes: ${plan.persistence.plannedWrites.join(', ')}\n`);
}

function printSimulation(result: Awaited<ReturnType<SimulationRuntime['simulate']>>): void {
  process.stdout.write(`Simulation: ${result.runId}\n`);
  process.stdout.write(`Loop: ${result.loopId}\n`);
  process.stdout.write(`Stages: ${result.stages.length}\n`);
  for (const stage of result.stages) {
    process.stdout.write(`- ${stage.id}: ${stage.title} [${stage.status}]\n`);
  }
  process.stdout.write(`Findings: ${result.summary.findings}\n`);
  process.stdout.write(`Generator runs: ${result.summary.generatorRuns}\n`);
  process.stdout.write(`Evaluator runs: ${result.summary.evaluatorRuns}\n`);
  process.stdout.write(`Knowledge cases: ${result.summary.knowledgeCases}\n`);
  process.stdout.write(`Report: ${path.relative(process.cwd(), result.artifacts.reportPath)}\n`);
  process.stdout.write(`Case: ${path.relative(process.cwd(), result.artifacts.casePath)}\n`);
}

function printHelp(): void {
  process.stdout.write(`Usage:
  loop validate [--workspace workspace] [--loop morning-triage] [--json]
  loop dry-run  [--workspace workspace] [--loop morning-triage] [--target-project id] [--target-repository repo] [--target-cwd path] [--target-remote remote] [--json]
  loop simulate [--workspace workspace] [--loop morning-triage] [--json]
  loop memory <init|validate|doctor|index|search|context|capture|promote|report> [...]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
