import path from 'node:path';
import { AgentRuntime } from '../../agent-runtime/src/agentRuntime';
import { BudgetGuard } from '../../budget-guard/src/budgetGuard';
import { ConnectorRuntime } from '../../connector-runtime/src/connectorRuntime';
import { ContextEngine } from '../../context-engine/src/contextEngine';
import { EvaluatorRuntime } from '../../evaluator-runtime/src/evaluatorRuntime';
import { HarnessRuntime } from '../../harness-runtime/src/harnessRuntime';
import { HumanGate } from '../../human-gate/src/humanGate';
import { MemoryStore } from '../../memory-store/src/memoryStore';
import { Scheduler } from '../../scheduler/src/scheduler';
import { readYamlFile } from '../../shared/src/fs';
import { LoopSpec, RuntimePlan } from '../../shared/src/types';
import { SkillRuntime } from '../../skill-runtime/src/skillRuntime';
import { WorktreeManager } from '../../worktree-manager/src/worktreeManager';

export interface RuntimeOptions {
  workspaceRoot: string;
  loopPath: string;
  now?: Date;
}

export class LoopRuntime {
  async dryRun(options: RuntimeOptions): Promise<RuntimePlan> {
    const workspaceRoot = path.resolve(options.workspaceRoot);
    const loop = await readYamlFile<LoopSpec>(options.loopPath);

    const scheduler = new Scheduler(loop);
    const budget = new BudgetGuard(loop.budget).check();
    const memoryStore = new MemoryStore(workspaceRoot, loop);
    const skillRuntime = new SkillRuntime(workspaceRoot);
    const connectorRuntime = new ConnectorRuntime(workspaceRoot);
    const contextEngine = new ContextEngine();
    const worktreeManager = new WorktreeManager(workspaceRoot, loop);
    const harnessRuntime = new HarnessRuntime(workspaceRoot);
    const agentRuntime = new AgentRuntime(workspaceRoot);
    const evaluatorRuntime = new EvaluatorRuntime();
    const humanGate = new HumanGate(loop);

    const [state, inbox, skill, evidence, harness, evaluator] = await Promise.all([
      memoryStore.readState(),
      memoryStore.readInbox(),
      skillRuntime.loadDiscoverySkill(loop),
      connectorRuntime.collect(loop.discovery.sources),
      harnessRuntime.load(loop),
      agentRuntime.loadAgent(loop.verification.evaluator)
    ]);

    const context = contextEngine.buildDiscoveryContext({
      loop,
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

    return {
      loopId: loop.metadata.id,
      schedule: scheduler.plan(),
      budget,
      context: {
        skillPath: path.relative(workspaceRoot, context.skill.path),
        evidenceSources: context.evidence.length,
        stateFile: path.relative(workspaceRoot, memoryStore.stateFile()),
        inboxFile: path.relative(workspaceRoot, memoryStore.inboxFile()),
        maxCharacters: context.maxCharacters
      },
      findings,
      handoff: worktrees,
      generatorRuns,
      evaluations,
      persistence: {
        stateFile: path.relative(workspaceRoot, memoryStore.stateFile()),
        inboxFile: path.relative(workspaceRoot, memoryStore.inboxFile()),
        runLog: path.relative(workspaceRoot, memoryStore.runLog()),
        plannedWrites: memoryStore.plannedWrites()
      },
      humanGate: humanGate.plan()
    };
  }
}
