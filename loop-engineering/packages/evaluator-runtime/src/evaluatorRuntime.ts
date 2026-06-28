import { AgentSpec, EvaluationPlan, LoopSpec, WorktreePlan } from '../../shared/src/types';

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
}
