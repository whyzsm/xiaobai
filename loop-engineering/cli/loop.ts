#!/usr/bin/env node
import path from 'node:path';
import { readFile, readdir } from 'node:fs/promises';
import { HarnessRuntime } from '../packages/harness-runtime/src/harnessRuntime';
import { GatePassStore, HumanGate } from '../packages/human-gate/src/humanGate';
import { LoopRuntime } from '../packages/loop-runtime/src/loopRuntime';
import { SimulationRuntime } from '../packages/simulation-runtime/src/simulationRuntime';
import { findLoopSpec, formatJson, readYamlFile } from '../packages/shared/src/fs';
import { GatePassEvidence, HarnessEvidenceType, LoopSpec } from '../packages/shared/src/types';
import { resolveMemoryRoot } from '../packages/shared/src/memoryRoot';
import { validateWorkspace } from '../packages/shared/src/validation';
import { runMemoryCommand } from './memory';
import { resolveProjectRoute } from '../packages/project-registry/src/projectRegistry';
import { resolveXiaonengRuntime } from '../packages/xiaoneng-context-runtime/src/xiaonengContextRuntime';

interface CliOptions {
  command: string;
  workspace: string;
  loop?: string;
  json: boolean;
  targetProject?: string;
  targetRepository?: string;
  userMessage?: string;
  targetCwd?: string;
  targetRemote?: string;
  xiaonengExecutionMode?: string;
  resultPath?: string;
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

  if (options.command === 'route') {
    await runRouteCommand(options, workspaceRoot);
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

  if (options.command === 'gate') {
    await runGateCommand(options, workspaceRoot, loopPath);
    return;
  }

  if (options.command === 'harness-check') {
    const validation = await validateWorkspace(workspaceRoot, loopPath);
    if (!validation.ok) {
      process.stderr.write(`Validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}\n`);
      process.exitCode = 1;
      return;
    }
    if (!options.resultPath) {
      throw new Error('harness-check requires --result <json-file>');
    }

    const loop = await readYamlFile<LoopSpec>(loopPath);
    const harnessRuntime = new HarnessRuntime(workspaceRoot);
    const harness = await harnessRuntime.load(loop);
    const submission = JSON.parse(await readFile(path.resolve(process.cwd(), options.resultPath), 'utf8')) as unknown;
    const result = harnessRuntime.evaluateRun(loop, harness, submission);
    if (options.json) {
      process.stdout.write(formatJson(result));
    } else {
      printHarnessResult(result);
    }
    process.exitCode = result.status === 'passed' ? 0 : 1;
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
    const plan = await runtime.dryRun({
      workspaceRoot,
      loopPath,
      targetProject: options.targetProject,
      targetRepository: options.targetRepository,
      userMessage: options.userMessage,
      targetCwd: options.targetCwd,
      targetRemote: options.targetRemote,
      xiaonengExecutionMode: options.xiaonengExecutionMode
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

async function runRouteCommand(options: CliOptions, workspaceRoot: string): Promise<void> {
  const loopPath = await findLoopSpec(workspaceRoot, options.loop ?? 'frontend-delivery');
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const route = await resolveProjectRoute(workspaceRoot, loop, {
    targetProject: options.targetProject,
    targetRepository: options.targetRepository,
    userMessage: options.userMessage,
    targetCwd: options.targetCwd,
    targetRemote: options.targetRemote
  });
  const targetRepository = route.targetRepository;
  if (!targetRepository) {
    throw new Error('PROJECT_ROUTE_INCOMPLETE: a target repository is required for host routing');
  }

  const background = route.project.background;
  const xiaoneng = background?.runtime?.type === 'manifest-source'
    ? await resolveXiaonengRuntime({
        sourceRoot: path.resolve(route.projectRoot, background.mount),
        projectRoot: route.projectRoot,
        project: route.project,
        targetRepository,
        taskId: `host-route-${targetRepository.id}`,
        executionMode: options.xiaonengExecutionMode,
        authorizedActions: ['read', 'plan'],
        consumerAgent: 'xiaoneng-agent'
      })
    : undefined;

  const result = {
    host: 'xiaobai',
    project: {
      id: route.project.id,
      kind: route.project.kind,
      root: route.projectRoot,
      routeSource: route.resolution.source,
      routeTarget: route.resolution.target,
      matchedRepositoryId: route.resolution.matchedRepositoryId,
      projectScopeRepositories: route.projectScopeRepositories.map((repository) => repository.id)
    },
    targetRepository: {
      id: targetRepository.id,
      mount: path.resolve(route.projectRoot, targetRepository.mount)
    },
    background: background
      ? {
          id: background.id,
          mount: path.resolve(route.projectRoot, background.mount),
          runtime: background.runtime?.type
        }
      : undefined,
    executor: xiaoneng ? 'xiaoneng' : 'xiaobai',
    xiaoneng: xiaoneng
      ? {
          agentId: xiaoneng.skillContext.skillId,
          entryPath: xiaoneng.skillContext.entryPath,
          entryHash: xiaoneng.skillContext.entryHash,
          manifestPath: xiaoneng.skillContext.manifestPath,
          manifestDigest: xiaoneng.skillContext.manifestDigest,
          executionMode: xiaoneng.skillContext.executionMode,
          ownerAgent: xiaoneng.skillContext.ownerAgent,
          ownerSkills: xiaoneng.skillContext.ownerSkills,
          selectedReferences: xiaoneng.skillContext.selectedReferences,
          contextDigest: xiaoneng.skillContext.contextDigest,
          sourceConsumption: xiaoneng.sourceConsumption,
          taskContextLock: {
            taskId: xiaoneng.taskContextLock.taskId,
            targetRepository: xiaoneng.taskContextLock.targetRepository,
            branch: xiaoneng.taskContextLock.branch,
            head: xiaoneng.taskContextLock.head,
            dirty: xiaoneng.taskContextLock.worktreeStatus.length > 0,
            statusCount: xiaoneng.taskContextLock.worktreeStatus.length
          }
        }
      : undefined,
    write: 'none'
  };

  if (options.json) {
    process.stdout.write(formatJson(result));
    return;
  }

  process.stdout.write([
    `Host: ${result.host}`,
    `Project: ${result.project.id} (${result.project.kind})`,
    `Route source: ${result.project.routeSource}`,
    `Target repository: ${result.targetRepository.id}`,
    `Executor: ${result.executor}`,
    ...(result.xiaoneng
      ? [
          `Manifest: ${result.xiaoneng.manifestPath}`,
          `Entry: ${result.xiaoneng.entryPath}`,
          `Mode: ${result.xiaoneng.executionMode}`,
          `Owner: ${result.xiaoneng.ownerAgent}`,
          `Skills: ${result.xiaoneng.ownerSkills.join(', ')}`,
          `Consumed files: ${result.xiaoneng.sourceConsumption.files.length}`
        ]
      : []),
    'Write: none'
  ].join('\n') + '\n');
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
    } else if (arg === '--request-text') {
      options.userMessage = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-cwd') {
      options.targetCwd = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--target-remote') {
      options.targetRemote = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--xiaoneng-execution-mode') {
      options.xiaonengExecutionMode = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--result') {
      options.resultPath = requireValue(rest, index, arg);
      index += 1;
    } else if (arg === '--json') {
      options.json = true;
    } else {
      options.rest.push(arg);
    }
  }

  return options;
}

async function runGateCommand(options: CliOptions, workspaceRoot: string, loopPath: string): Promise<void> {
  const validation = await validateWorkspace(workspaceRoot, loopPath);
  if (!validation.ok) {
    process.stderr.write(`Validation failed:\n${validation.errors.map((error) => `- ${error}`).join('\n')}\n`);
    process.exitCode = 1;
    return;
  }

  const [subcommand = 'help', ...args] = options.rest;
  const loop = await readYamlFile<LoopSpec>(loopPath);
  const humanGate = new HumanGate(loop);
  const store = new GatePassStore(await resolveMemoryRoot(workspaceRoot), loop.metadata.id);

  if (subcommand === 'list') {
    const flags = parseGateFlags(args, []);
    assertNoGateFlags(flags, subcommand);
    const result = {
      loopId: loop.metadata.id,
      passLog: store.filePath(),
      ...humanGate.plan()
    };
    if (options.json) process.stdout.write(formatJson(result));
    else printGateList(result);
    return;
  }

  if (subcommand === 'approve') {
    const flags = parseGateFlags(args, [
      'gate',
      'run-id',
      'task-id',
      'stage',
      'subject-digest',
      'issuer',
      'evidence'
    ]);
    const event = humanGate.grant({
      gateId: requireGateFlag(flags, 'gate'),
      runId: requireGateFlag(flags, 'run-id'),
      taskId: requireGateFlag(flags, 'task-id'),
      stageId: optionalGateFlag(flags, 'stage'),
      subjectDigest: requireGateFlag(flags, 'subject-digest'),
      issuer: requireGateFlag(flags, 'issuer'),
      evidence: (flags.get('evidence') ?? []).map(parseGateEvidence)
    });
    await store.append(event);
    if (options.json) process.stdout.write(formatJson(event));
    else printGateEvent(event);
    return;
  }

  if (subcommand === 'check') {
    const flags = parseGateFlags(args, ['run-id', 'task-id', 'stage', 'action', 'subject-digest']);
    const stageId = optionalGateFlag(flags, 'stage');
    const action = optionalGateFlag(flags, 'action');
    if (Boolean(stageId) === Boolean(action)) {
      throw new Error('gate check requires exactly one of --stage or --action');
    }
    const result = humanGate.check(
      {
        runId: requireGateFlag(flags, 'run-id'),
        taskId: requireGateFlag(flags, 'task-id'),
        stageId,
        action,
        subjectDigest: requireGateFlag(flags, 'subject-digest')
      },
      await store.readAll()
    );
    if (options.json) process.stdout.write(formatJson(result));
    else printGateDecision(result);
    process.exitCode = result.status === 'passed' ? 0 : 1;
    return;
  }

  if (subcommand === 'revoke') {
    const flags = parseGateFlags(args, ['pass-id', 'issuer', 'reason']);
    const passId = requireGateFlag(flags, 'pass-id');
    const current = await store.current(passId);
    if (!current) throw new Error(`Unknown GatePass: ${passId}`);
    const event = humanGate.revoke(
      current,
      requireGateFlag(flags, 'issuer'),
      requireGateFlag(flags, 'reason')
    );
    await store.append(event);
    if (options.json) process.stdout.write(formatJson(event));
    else printGateEvent(event);
    return;
  }

  throw new Error('gate requires one of: list, approve, check, revoke');
}

function parseGateFlags(args: string[], allowed: string[]): Map<string, string[]> {
  const allowedFlags = new Set(allowed);
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    if (!flag?.startsWith('--')) throw new Error(`Unexpected gate argument: ${flag ?? ''}`);
    const name = flag.slice(2);
    if (!allowedFlags.has(name)) throw new Error(`Unknown gate option: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    values.set(name, [...(values.get(name) ?? []), value]);
  }
  return values;
}

function assertNoGateFlags(flags: Map<string, string[]>, command: string): void {
  if (flags.size > 0) throw new Error(`gate ${command} does not accept options`);
}

function requireGateFlag(flags: Map<string, string[]>, name: string): string {
  const value = optionalGateFlag(flags, name);
  if (!value) throw new Error(`Missing value for --${name}`);
  return value;
}

function optionalGateFlag(flags: Map<string, string[]>, name: string): string | undefined {
  const values = flags.get(name) ?? [];
  if (values.length > 1 && name !== 'evidence') throw new Error(`Gate option may only be provided once: --${name}`);
  return values[0];
}

function parseGateEvidence(value: string): GatePassEvidence {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error('Gate evidence must use <type>:<value>');
  }
  return {
    type: value.slice(0, separator) as HarnessEvidenceType,
    value: value.slice(separator + 1)
  };
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
  process.stdout.write(`Loop work count: ${plan.loopWorkCount}\n`);
  process.stdout.write(`Schedule: ${plan.schedule.type} ${plan.schedule.expression} (${plan.schedule.timezone})\n`);
  process.stdout.write(`Budget: ${plan.budget.ok ? 'ok' : plan.budget.reasons.join(', ')}\n`);
  process.stdout.write(`Execution: ${plan.execution.executor} (${plan.execution.agentId}, ${plan.execution.source})\n`);
  if (plan.execution.handoff) {
    process.stdout.write(
      `Xiaoneng handoff: ${plan.execution.handoff.targetRepository} -> ${plan.execution.handoff.entryPath}\n`
    );
  }
  if (plan.orchestrator) {
    const project = plan.orchestrator.routesTo.project;
    const resolvedTarget = project.resolution.matchedRepositoryId ?? project.resolution.target ?? project.projectId;
    process.stdout.write(`Orchestrator: ${plan.orchestrator.agentId} (${plan.orchestrator.agentFile})\n`);
    process.stdout.write(
      `Effective orchestrator: ${plan.orchestrator.effective.agentId} (${plan.orchestrator.effective.source})\n`
    );
    if (plan.orchestrator.effective.entryPath && plan.orchestrator.effective.manifestPath) {
      process.stdout.write(
        `Route evidence: entry=${plan.orchestrator.effective.entryPath}, manifest=${plan.orchestrator.effective.manifestPath}, ` +
        `mode=${plan.orchestrator.effective.executionMode}, owner=${plan.orchestrator.effective.ownerAgent}, ` +
        `skills=${plan.orchestrator.effective.ownerSkills?.join(',')}\n`
      );
    }
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
  process.stdout.write(`Loop work count: ${result.loopWorkCount}\n`);
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

function printHarnessResult(result: ReturnType<HarnessRuntime['evaluateRun']>): void {
  process.stdout.write(`Harness run: ${result.runId}\n`);
  process.stdout.write(`Task: ${result.taskId}\n`);
  process.stdout.write(`Agent: ${result.agentId}\n`);
  process.stdout.write(`Harness: ${result.harnessId}\n`);
  process.stdout.write(`Status: ${result.status}\n`);
  process.stdout.write(`Duration: ${result.durationMs === null ? 'unmeasured' : `${result.durationMs}ms`}\n`);
  for (const [name, passed] of Object.entries(result.checks)) {
    process.stdout.write(`- ${name}: ${passed ? 'passed' : 'failed'}\n`);
  }
  const violations = Object.entries(result.violations)
    .filter(([, value]) => value === true || (Array.isArray(value) && value.length > 0));
  if (violations.length > 0) {
    process.stdout.write('Violations:\n');
    for (const [name, value] of violations) {
      process.stdout.write(`- ${name}: ${Array.isArray(value) ? value.join(', ') : String(value)}\n`);
    }
  }
}

function printGateList(result: ReturnType<HumanGate['plan']> & { loopId: string; passLog: string }): void {
  process.stdout.write(`Loop: ${result.loopId}\n`);
  process.stdout.write(`GatePass log: ${result.passLog}\n`);
  for (const gate of result.gates) {
    process.stdout.write(
      `- ${gate.id}: before ${gate.requiredBefore}, reviewers ${gate.reviewers.join(', ')}, max age ${gate.maxAgeMinutes}m\n`
    );
  }
}

function printGateEvent(event: Awaited<ReturnType<GatePassStore['current']>> & {}): void {
  if (!event) return;
  process.stdout.write(`GatePass: ${event.passId}\n`);
  process.stdout.write(`Gate: ${event.gateId}\n`);
  process.stdout.write(`Status: ${event.status}\n`);
  process.stdout.write(`Issuer: ${event.issuer}\n`);
  if (event.expiresAt) process.stdout.write(`Expires: ${event.expiresAt}\n`);
  if (event.reason) process.stdout.write(`Reason: ${event.reason}\n`);
}

function printGateDecision(result: ReturnType<HumanGate['check']>): void {
  process.stdout.write(`Gate check: ${result.status}\n`);
  process.stdout.write(`Required: ${result.requiredGates.join(', ') || 'none'}\n`);
  process.stdout.write(`Satisfied: ${result.satisfiedGates.join(', ') || 'none'}\n`);
  for (const reason of result.blockingReasons) process.stdout.write(`- ${reason}\n`);
}

function printHelp(): void {
  process.stdout.write(`Usage:
  loop validate [--workspace workspace] [--loop morning-triage] [--json]
  loop harness-check --loop <loop-id> --result <json-file> [--workspace workspace] [--json]
  loop gate list --loop <loop-id> [--workspace workspace] [--json]
  loop gate approve --loop <loop-id> --gate <gate-id> --run-id <id> --task-id <id> [--stage <stage-id>] --subject-digest <sha256:...> --issuer <reviewer> --evidence <type:value>... [--json]
  loop gate check --loop <loop-id> --run-id <id> --task-id <id> <--stage <stage-id>|--action <action>> --subject-digest <sha256:...> [--json]
  loop gate revoke --loop <loop-id> --pass-id <id> --issuer <reviewer> --reason <text> [--json]
  loop dry-run  [--workspace workspace] [--loop morning-triage] [--target-project id] [--target-repository repo] [--request-text message] [--target-cwd path] [--target-remote remote] [--xiaoneng-execution-mode mode] [--json]
  loop route    [--workspace workspace] [--loop frontend-delivery] [--target-project id] [--target-repository repo] [--request-text message] [--target-cwd path] [--target-remote remote] [--xiaoneng-execution-mode mode] [--json]
  loop simulate [--workspace workspace] [--loop morning-triage] [--json]
  loop memory <init|validate|doctor|index|search|context|capture|checkpoint|audit-today|promote|report|snapshot> [...]
`);
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
