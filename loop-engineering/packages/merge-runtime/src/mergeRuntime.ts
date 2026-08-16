import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import {
  BrokerDecision,
  GatePassEvidence,
  MergeConflictEvidence,
  PromotionPlan
} from '../../shared/src/types';
import { assertValidPromotionPlan } from '../../shared/src/portableExecutionContracts';

const execFileAsync = promisify(execFile);

export interface ConflictDetectionInput {
  repositoryPath: string;
  targetBranch: string;
  sourceBranches: string[];
}

export interface PromotionPlanInput {
  taskId: string;
  sourceBranch: string;
  targetBranch: string;
  requiredGates: string[];
  brokerDecisions?: BrokerDecision[];
  conflicts?: MergeConflictEvidence[];
  evidence?: GatePassEvidence[];
  now?: Date;
}

export class MergeRuntime {
  async detectConflicts(input: ConflictDetectionInput): Promise<MergeConflictEvidence[]> {
    const conflicts: MergeConflictEvidence[] = [];
    for (const sourceBranch of input.sourceBranches) {
      conflicts.push(...await detectBranchConflict(input.repositoryPath, input.targetBranch, sourceBranch));
    }
    for (let left = 0; left < input.sourceBranches.length; left += 1) {
      for (let right = left + 1; right < input.sourceBranches.length; right += 1) {
        conflicts.push(...await detectBranchConflict(input.repositoryPath, input.sourceBranches[left], input.sourceBranches[right]));
      }
    }
    return dedupeConflicts(conflicts);
  }

  buildPromotionPlan(input: PromotionPlanInput): PromotionPlan {
    const now = (input.now ?? new Date()).toISOString();
    const conflicts = input.conflicts ?? [];
    const plan: PromotionPlan = {
      kind: 'PromotionPlan',
      version: 1,
      promotionId: `promotion-${randomUUID()}`,
      taskId: input.taskId,
      sourceBranch: input.sourceBranch,
      targetBranch: input.targetBranch,
      state: conflicts.length > 0 ? 'blocked' : 'queued',
      requiredGates: input.requiredGates,
      brokerDecisions: input.brokerDecisions ?? [],
      conflicts,
      evidence: input.evidence ?? [],
      createdAt: now,
      updatedAt: now
    };
    assertValidPromotionPlan(plan);
    return plan;
  }
}

async function detectBranchConflict(
  repositoryPath: string,
  leftBranch: string,
  rightBranch: string
): Promise<MergeConflictEvidence[]> {
  const base = (await execFileAsync('git', ['merge-base', leftBranch, rightBranch], {
    cwd: repositoryPath,
    encoding: 'utf8'
  })).stdout.trim();
  const output = (await execFileAsync('git', ['merge-tree', base, leftBranch, rightBranch], {
    cwd: repositoryPath,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024
  })).stdout;
  if (!hasConflict(output)) return [];
  return extractConflictFiles(output).map((file) => ({
    file,
    reason: `${leftBranch} conflicts with ${rightBranch}`,
    evidence: [{ type: 'diff', value: digestEvidence(output) }]
  }));
}

function hasConflict(output: string): boolean {
  return output.includes('<<<<<<<') || /changed in both|added in both|removed in both/i.test(output);
}

function extractConflictFiles(output: string): string[] {
  const files = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^changed in both\s+(.+)$/i)
      ?? line.match(/^added in both\s+(.+)$/i)
      ?? line.match(/^removed in both\s+(.+)$/i);
    if (match?.[1]) files.add(match[1].trim());
  }
  return files.size > 0 ? [...files] : ['<unknown>'];
}

function dedupeConflicts(conflicts: MergeConflictEvidence[]): MergeConflictEvidence[] {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.file}:${conflict.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function digestEvidence(value: string): string {
  return `merge-tree-conflict:${createHash('sha256').update(value).digest('hex')}`;
}
