import {
  AgentSpec,
  EvaluationPlan,
  EvaluationVerdict,
  GatePassEvidence,
  HarnessRunResult,
  LoopSpec,
  WorkflowStagePlan,
  WorktreePlan
} from '../../shared/src/types';

export class EvaluatorRuntime {
  plan(loop: LoopSpec, evaluator: AgentSpec, worktrees: WorktreePlan[]): EvaluationPlan[] {
    return worktrees.map((worktree) => ({
      taskId: worktree.taskId,
      evaluatorId: evaluator.id,
      requiredChecks: loop.verification.requiredChecks,
      decision: 'pending_independent_review',
      allowSelfReview: loop.verification.allowSelfReview
    }));
  }

  decide(input: {
    loop: LoopSpec;
    stage: WorkflowStagePlan;
    runId: string;
    taskId: string;
    harnessResult: HarnessRunResult;
    evidence: GatePassEvidence[];
  }): EvaluationVerdict {
    if (!input.stage.evaluator) {
      throw new Error(`Workflow stage ${input.stage.id} has no evaluator`);
    }
    const evaluatorId = input.stage.evaluator.replace(/\.agent\.yaml$/, '');
    const generatorId = input.loop.generator.agent.replace(/\.agent\.yaml$/, '');
    const independent = evaluatorId !== generatorId;
    const reasons: string[] = [];
    if (!independent) reasons.push(`Evaluator ${evaluatorId} is the configured generator`);
    if (input.harnessResult.status !== 'passed') {
      reasons.push(`Evaluator submission failed Harness: ${summarizeViolations(input.harnessResult)}`);
    }
    return {
      loopId: input.loop.metadata.id,
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stage.id,
      evaluatorId,
      independent,
      decision: independent && input.harnessResult.status === 'passed' ? 'approved' : 'rejected',
      requiredChecks: [...input.stage.requiredChecks],
      reasons,
      evidence: input.evidence
    };
  }
}

function summarizeViolations(result: HarnessRunResult): string {
  return Object.entries(result.violations)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value === true)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join('; ') || 'unknown violation';
}
