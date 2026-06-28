import { HumanGatePlan, LoopSpec } from '../../shared/src/types';

export class HumanGate {
  constructor(private readonly loop: LoopSpec) {}

  plan(): HumanGatePlan {
    return {
      protectedActions: this.loop.humanGate.requiredBefore,
      reviewers: this.loop.humanGate.reviewers
    };
  }
}
