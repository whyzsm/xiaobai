import {
  GateCheckInput,
  GateDecision,
  LoopSpec
} from '../../shared/src/types';
import { GatePassStore, HumanGate } from './humanGate';

export class GateCheckService {
  private readonly humanGate: HumanGate;

  constructor(
    loop: LoopSpec,
    private readonly passStore: GatePassStore
  ) {
    this.humanGate = new HumanGate(loop);
  }

  static forMemoryRoot(loop: LoopSpec, memoryRoot: string): GateCheckService {
    return new GateCheckService(loop, new GatePassStore(memoryRoot, loop.metadata.id));
  }

  async check(input: GateCheckInput): Promise<GateDecision> {
    if (!input.stageId && (!input.actions || input.actions.length === 0)) {
      return {
        status: 'passed',
        requiredGates: [],
        satisfiedGates: [],
        blockingReasons: [],
        passes: []
      };
    }
    const preliminary = this.humanGate.check(input, []);
    if (preliminary.status === 'passed' && preliminary.requiredGates.length === 0) {
      return preliminary;
    }

    try {
      return this.humanGate.check(input, await this.passStore.readAll());
    } catch (error) {
      return {
        status: 'blocked',
        requiredGates: preliminary.requiredGates,
        satisfiedGates: [],
        blockingReasons: [
          ...preliminary.blockingReasons,
          `GatePass store unavailable: ${error instanceof Error ? error.message : String(error)}`
        ],
        passes: []
      };
    }
  }
}
