import { LoopSpec } from '../../shared/src/types';

export class Scheduler {
  constructor(private readonly loop: LoopSpec) {}

  plan() {
    return {
      type: this.loop.schedule.type,
      expression: this.loop.schedule.expression,
      timezone: this.loop.schedule.timezone,
      nextAction: `wait for ${this.loop.schedule.type} trigger`
    };
  }
}
