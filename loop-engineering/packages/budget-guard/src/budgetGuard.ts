import { BudgetLimits } from '../../shared/src/types';

export class BudgetGuard {
  constructor(private readonly limits: BudgetLimits) {}

  check(): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];

    if (this.limits.maxTokensPerRun <= 0) {
      reasons.push('maxTokensPerRun must be greater than zero');
    }
    if (this.limits.maxRetriesPerTask < 0) {
      reasons.push('maxRetriesPerTask cannot be negative');
    }
    if (this.limits.maxParallelTasks <= 0) {
      reasons.push('maxParallelTasks must be greater than zero');
    }

    return {
      ok: reasons.length === 0,
      reasons
    };
  }
}
