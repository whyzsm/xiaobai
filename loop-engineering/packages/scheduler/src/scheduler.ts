import { LoopSpec } from '../../shared/src/types';
import { WorkflowExecutor, WorkflowExecutorOptions, WorkflowTask } from './workflowExecutor';

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

  createWorkflowExecutor(
    tasks: WorkflowTask[],
    options: Omit<WorkflowExecutorOptions, 'maxParallelTasks'>
  ): WorkflowExecutor {
    return new WorkflowExecutor(tasks, {
      ...options,
      maxParallelTasks: this.loop.budget.maxParallelTasks
    });
  }
}
