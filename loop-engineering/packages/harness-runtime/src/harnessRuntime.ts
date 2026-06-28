import path from 'node:path';
import { AgentRunPlan, HarnessSpec, LoopSpec, WorktreePlan } from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';

export class HarnessRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async load(loop: LoopSpec): Promise<HarnessSpec> {
    return readYamlFile<HarnessSpec>(path.join(this.workspaceRoot, 'agents', loop.generator.harness));
  }

  planGeneratorRuns(loop: LoopSpec, harness: HarnessSpec, worktrees: WorktreePlan[]): AgentRunPlan[] {
    return worktrees.map((worktree) => ({
      taskId: worktree.taskId,
      agentId: loop.generator.agent.replace(/\.agent\.yaml$/, ''),
      harnessId: harness.metadata.id,
      worktreePath: worktree.path,
      expectedOutput: harness.output.required
    }));
  }
}
