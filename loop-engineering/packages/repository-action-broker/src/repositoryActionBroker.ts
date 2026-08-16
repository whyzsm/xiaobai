import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  BrokerDecision,
  GateDecision,
  RepositoryAction,
  WorkspaceLease
} from '../../shared/src/types';

const execFileAsync = promisify(execFile);

export interface RepositoryActionRequest {
  action: RepositoryAction;
  lease: WorkspaceLease;
  gateDecision?: Pick<GateDecision, 'status' | 'blockingReasons' | 'satisfiedGates'>;
  now?: Date;
}

export interface PushRequest extends RepositoryActionRequest {
  action: 'push';
  remote: string;
}

export class RepositoryActionBroker {
  decide(input: RepositoryActionRequest): BrokerDecision {
    const reasons = authorizationFailures(input);
    const decidedAt = (input.now ?? new Date()).toISOString();
    return {
      action: input.action,
      status: reasons.length === 0 ? 'authorized' : 'blocked',
      reasons,
      evidence: reasons.length === 0
        ? [{ type: 'human-approval', value: `gate satisfied for ${input.action}` }]
        : [{ type: 'other', value: reasons.join('; ') }],
      decidedAt
    };
  }

  async push(input: PushRequest): Promise<BrokerDecision> {
    const decision = this.decide(input);
    if (decision.status !== 'authorized') return decision;
    try {
      await execFileAsync('git', ['push', input.remote, input.lease.branch], {
        cwd: input.lease.repositoryPath
      });
      return {
        ...decision,
        status: 'completed',
        evidence: [
          ...decision.evidence,
          { type: 'command', value: `git push ${input.remote} ${input.lease.branch}` }
        ]
      };
    } catch (error) {
      return {
        ...decision,
        status: 'failed',
        reasons: [`git push failed: ${error instanceof Error ? error.message : String(error)}`],
        evidence: [
          ...decision.evidence,
          { type: 'command', value: `git push ${input.remote} ${input.lease.branch}` }
        ]
      };
    }
  }
}

function authorizationFailures(input: RepositoryActionRequest): string[] {
  const reasons: string[] = [];
  if ((input.action === 'delete_worktree' || input.action === 'destructive_cleanup') && input.lease.state === 'dirty_retained') {
    reasons.push('dirty worktree cleanup requires explicit human recovery outside the broker');
  }
  if (!input.gateDecision || input.gateDecision.status !== 'passed') {
    reasons.push(...(input.gateDecision?.blockingReasons.length ? input.gateDecision.blockingReasons : ['gate_required']));
  }
  if (input.lease.state !== 'claimed' && input.lease.state !== 'active') {
    reasons.push(`lease must be claimed or active, received ${input.lease.state}`);
  }
  if (input.lease.owner?.role !== 'writer') {
    reasons.push('lease requires writer owner');
  }
  if ((input.action === 'push' || input.action === 'pull_request' || input.action === 'merge') && !input.lease.branch) {
    reasons.push(`${input.action} requires task lease branch`);
  }
  return reasons;
}
