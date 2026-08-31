import path from 'node:path';
import { AgentRuntime } from '../../agent-runtime/src/agentRuntime';
import { BudgetGuard } from '../../budget-guard/src/budgetGuard';
import { ConnectorRuntime } from '../../connector-runtime/src/connectorRuntime';
import { ContextEngine } from '../../context-engine/src/contextEngine';
import { EvaluatorRuntime } from '../../evaluator-runtime/src/evaluatorRuntime';
import { HarnessRuntime } from '../../harness-runtime/src/harnessRuntime';
import { HumanGate } from '../../human-gate/src/humanGate';
import { MemoryStore } from '../../memory-store/src/memoryStore';
import { MemoryRootConfig, resolveMemoryRootConfig } from '../../shared/src/memoryRoot';
import { Scheduler } from '../../scheduler/src/scheduler';
import { readYamlFile } from '../../shared/src/fs';
import {
  AgentSpec,
  BackgroundContextPlan,
  LoopSpec,
  OrchestratorPlan,
  ProjectContext,
  ProjectRoutePlan,
  ProjectSpec,
  RuntimePlan,
  WorkflowPlan
} from '../../shared/src/types';
import { SkillRuntime } from '../../skill-runtime/src/skillRuntime';
import { WorktreeManager } from '../../worktree-manager/src/worktreeManager';
import { buildMemoryIndex, writeMemoryIndexAtomic } from '../../memory-indexer/src';
import { loadMemoryContext } from '../../memory-context/src';
import { resolveMemoryProtocolPaths } from '../../memory-protocol/src';
import { pathExists } from '../../shared/src/fs';
import { ResolvedProjectRoute, resolveProjectRoute } from '../../project-registry/src/projectRegistry';
import { buildProjectContext } from '../../shared/src/projectContext';

export interface RuntimeOptions {
  workspaceRoot: string;
  loopPath: string;
  now?: Date;
  targetProject?: string;
  targetRepository?: string;
  targetCwd?: string;
  targetRemote?: string;
}

export class LoopRuntime {
  async dryRun(options: RuntimeOptions): Promise<RuntimePlan> {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const loop = await readYamlFile<LoopSpec>(options.loopPath);
    const memoryConfig = await resolveMemoryRootConfig(workspaceRoot);
    const memoryRoot = memoryConfig.memoryRoot;
    const projectRoute = await resolveProjectRoute(workspaceRoot, loop, {
      targetProject: options.targetProject,
      targetRepository: options.targetRepository,
      targetCwd: options.targetCwd,
      targetRemote: options.targetRemote
    });
    const project = projectRoute.project;
    const projectContext = buildProjectContext({
      workspaceRoot,
      loop,
      projectRoute
    });
    const projectRoutePlan = buildProjectRoutePlan(workspaceRoot, projectRoute, projectContext);

    const scheduler = new Scheduler(loop);
    const budget = new BudgetGuard(loop.budget).check();
    const memoryStore = new MemoryStore(workspaceRoot, memoryRoot, loop);
    const skillRuntime = new SkillRuntime(workspaceRoot);
    const connectorRuntime = new ConnectorRuntime(workspaceRoot);
    const contextEngine = new ContextEngine();
    const worktreeManager = new WorktreeManager(workspaceRoot, loop, project.id);
    const harnessRuntime = new HarnessRuntime(workspaceRoot);
    const agentRuntime = new AgentRuntime(workspaceRoot);
    const evaluatorRuntime = new EvaluatorRuntime();
    const humanGate = new HumanGate(loop);

    const [state, inbox, skill, evidence, harness, evaluator, orchestrator] = await Promise.all([
      memoryStore.readState(),
      memoryStore.readInbox(),
      skillRuntime.loadDiscoverySkill(loop, project.id, projectRoute.projectRoot, project),
      connectorRuntime.collect(loop.discovery.sources),
      harnessRuntime.load(loop),
      agentRuntime.loadAgent(loop.verification.evaluator, loop),
      loop.orchestrator?.agent ? agentRuntime.loadAgent(loop.orchestrator.agent, loop) : Promise.resolve(undefined)
    ]);

    const context = contextEngine.buildDiscoveryContext({
      loop,
      projectId: project.id,
      skill,
      state,
      inbox,
      evidence,
      maxCharacters: harness.context.maxCharacters
    });
    const findings = skillRuntime.selectFindings(context.evidence);
    const worktrees = worktreeManager.plan(findings, options.now);
    const generatorRuns = harnessRuntime.planGeneratorRuns(loop, harness, worktrees);
    const evaluations = evaluatorRuntime.plan(loop, evaluator, worktrees);
    const memoryContext = await buildMemoryContextMetadata({
      workspaceRoot,
      memoryRoot,
      memoryConfig,
      loop,
      projectId: project.id,
      maxCharacters: context.maxCharacters
    });
    const backgroundContext = buildBackgroundContextPlan(
      workspaceRoot,
      loop,
      projectRoute,
      harness.context.maxCharacters
    );

    return {
      loopId: loop.metadata.id,
      loopWorkCount: await memoryStore.runCount(),
      schedule: scheduler.plan(),
      budget,
      projectContext,
      projectRoute: projectRoutePlan,
      orchestrator: buildOrchestratorPlan(loop, orchestrator, projectRoutePlan),
      context: {
        skillPath: path.relative(workspaceRoot, context.skill.path),
        evidenceSources: context.evidence.length,
        stateFile: displayPath(workspaceRoot, memoryStore.stateFile()),
        inboxFile: displayPath(workspaceRoot, memoryStore.inboxFile()),
        maxCharacters: context.maxCharacters
      },
      findings,
      handoff: worktrees,
      generatorRuns,
      evaluations,
      persistence: {
        stateFile: displayPath(workspaceRoot, memoryStore.stateFile()),
        inboxFile: displayPath(workspaceRoot, memoryStore.inboxFile()),
        runLog: displayPath(workspaceRoot, memoryStore.runLog()),
        plannedWrites: memoryStore.plannedWrites()
      },
      humanGate: humanGate.plan(),
      workflow: buildWorkflowPlan(loop),
      ...(backgroundContext ? { backgroundContext } : {}),
      memoryContext
    };
  }
}

function buildBackgroundContextPlan(
  workspaceRoot: string,
  loop: LoopSpec,
  projectRoute: ResolvedProjectRoute,
  harnessMaxCharacters: number
): BackgroundContextPlan | undefined {
  const background = projectRoute.project.background;
  const integration = background?.integration;
  if (!background || !integration) return undefined;
  if (
    integration.kind !== 'skill-context' ||
    !['1.0.0', '2.0.0'].includes(integration.version) ||
    typeof integration.manifest !== 'string' ||
    typeof integration.contract !== 'string' ||
    (integration.executionModes !== undefined &&
      (typeof integration.executionModes !== 'object' || Array.isArray(integration.executionModes))) ||
    (integration.evidenceBundlesByLoop !== undefined &&
      !isEvidenceBundlesByLoop(integration.evidenceBundlesByLoop))
  ) {
    throw new Error(`Project ${projectRoute.project.id} has an invalid skill-context integration declaration`);
  }

  const executionMode = integration.executionModes?.[loop.metadata.id] ?? loop.metadata.id;
  const evidenceBundles = integration.evidenceBundlesByLoop?.[loop.metadata.id]
    ?? integration.evidenceBundles
    ?? [];
  if ((typeof executionMode !== 'string' || executionMode.length === 0) && evidenceBundles.length === 0) {
    throw new Error(
      `Project ${projectRoute.project.id} does not declare a skill-context execution mode or evidence bundle for loop ${loop.metadata.id}`
    );
  }

  return {
    status: 'planned',
    kind: 'skill-context',
    contractVersion: integration.contractVersion ?? '1.0.0',
    projectId: projectRoute.project.id,
    backgroundId: background.id,
    sourceMount: displayPath(
      workspaceRoot,
      path.resolve(projectRoute.projectRoot, background.mount)
    ),
    manifestPath: integration.manifest,
    contractPath: integration.contract,
    executionMode,
    ...(evidenceBundles.length > 0 ? { evidenceBundles } : {}),
    ...(integration.validators ? { validators: [...integration.validators] } : {}),
    maxCharacters: Math.floor(harnessMaxCharacters * 0.75)
  };
}

async function buildMemoryContextMetadata(input: {
  workspaceRoot: string;
  memoryRoot: string;
  memoryConfig: MemoryRootConfig;
  loop: LoopSpec;
  projectId: string;
  maxCharacters: number;
}): Promise<RuntimePlan['memoryContext']> {
  const projectId = inferProjectId(input.memoryRoot) ?? input.projectId;
  const protocol = resolveMemoryProtocolPaths({
    workspaceRoot: input.workspaceRoot,
    vaultRoot: input.memoryConfig.memoryVaultRoot ?? inferVaultRoot(input.memoryRoot),
    learningRootName: input.memoryConfig.memoryLearningRootName,
    projectId,
    loopId: input.loop.metadata.id
  });
  const index = await buildMemoryIndex({
    workspaceRoot: input.workspaceRoot,
    vaultRoot: protocol.vaultRoot,
    learningRootName: relativeLearningRoot(protocol)
  });
  if (!(await pathExists(protocol.indexPath))) {
    await writeMemoryIndexAtomic(protocol.indexPath, index);
  }
  const bundle = await loadMemoryContext({
    index,
    projectId,
    loopId: input.loop.metadata.id,
    query: input.loop.metadata.name,
    maxCharacters: input.maxCharacters
  });
  return {
    indexPath: protocol.indexPath,
    included: bundle.included.map((item) => ({
      path: displayPath(input.workspaceRoot, item.path),
      title: item.title,
      kind: item.kind,
      characters: item.characters
    })),
    omitted: bundle.omitted.map((item) => ({
      path: displayPath(input.workspaceRoot, item.path),
      title: item.title,
      reason: item.reason,
      characters: item.characters
    })),
    warnings: bundle.warnings
  };
}

function buildOrchestratorPlan(
  loop: LoopSpec,
  agent: AgentSpec | undefined,
  projectRoute: ProjectRoutePlan
): OrchestratorPlan | undefined {
  if (!loop.orchestrator || !agent) {
    return undefined;
  }

  return {
    agentId: agent.id,
    agentFile: loop.orchestrator.agent,
    role: agent.role,
    stance: agent.stance,
    routesTo: {
      discoverySkill: loop.discovery.skill,
      project: projectRoute,
      generatorAgent: loop.generator.agent,
      evaluatorAgent: loop.verification.evaluator,
      workflowStages: (loop.workflow?.stages ?? []).map((stage) => stage.id)
    }
  };
}

function buildProjectRoutePlan(
  workspaceRoot: string,
  projectRoute: ResolvedProjectRoute,
  projectContext: ProjectContext
): ProjectRoutePlan {
  const project = projectRoute.project;
  const projectRoot = projectRoute.projectRoot;
  return {
    projectContext,
    projectId: project.id,
    projectKind: project.kind,
    projectName: project.name,
    resolution: projectRoute.resolution,
    projectSkillPath: displayPath(workspaceRoot, path.join(projectRoot, project.skill)),
    root: displayPath(projectRoot, path.resolve(projectRoot, project.root)),
    defaultBranch: project.defaultBranch,
    background: project.background
      ? {
          id: project.background.id,
          name: project.background.name,
          mount: displayPath(projectRoot, path.resolve(projectRoot, project.background.mount))
        }
      : undefined,
    repositories: (project.repositories ?? []).map((repository) => ({
      id: repository.id,
      name: repository.name,
      mount: displayPath(projectRoot, path.resolve(projectRoot, repository.mount)),
      remote: repository.remote
    }))
  };
}

function relativeLearningRoot(paths: ReturnType<typeof resolveMemoryProtocolPaths>): string {
  return path.relative(paths.vaultRoot, paths.learningRoot).replaceAll(path.sep, '/');
}

function inferVaultRoot(memoryRoot: string): string {
  const marker = `${path.sep}88-学习${path.sep}`;
  const index = memoryRoot.indexOf(marker);
  return index >= 0 ? memoryRoot.slice(0, index) : memoryRoot;
}

function inferProjectId(memoryRoot: string): string | undefined {
  const parts = memoryRoot.split(path.sep);
  const markerIndex = parts.lastIndexOf('10-项目记忆');
  return markerIndex >= 0 ? parts[markerIndex + 1] : undefined;
}

function buildWorkflowPlan(loop: LoopSpec): WorkflowPlan | undefined {
  if (!loop.workflow) {
    return undefined;
  }

  return {
    stages: loop.workflow.stages.map((stage) => ({
      id: stage.id,
      kind: stage.kind,
      status: 'planned',
      gate: stage.gate ?? 'automatic',
      agent: stage.agent,
      harness: stage.harness,
      evaluator: stage.evaluator,
      dependsOn: stage.dependsOn ?? [],
      requiredChecks: stage.requiredChecks ?? [],
      requiredGates: stage.requiredGates ?? [],
      requiredBefore: stage.requiredBefore ?? [],
      ...(stage.validators !== undefined ? { validators: [...stage.validators] } : {}),
      outputs: stage.outputs ?? []
    }))
  };
}

function displayPath(workspaceRoot: string, filePath: string): string {
  const relativePath = path.relative(workspaceRoot, filePath);
  return relativePath === '..' || relativePath.startsWith(`..${path.sep}`) ? filePath : relativePath;
}

function isEvidenceBundlesByLoop(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (bundles) => Array.isArray(bundles) && bundles.every((bundle) => typeof bundle === 'string' && bundle.length > 0)
    )
  );
}
