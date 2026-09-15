import {
  StageEventStore,
  StageExecutionEvent,
  StageExecutionStatus,
  StageWaitingReason
} from './stageEventStore';

export interface WorkflowTaskResult {
  status: 'passed' | 'failed' | 'waiting' | 'skipped';
  evidence?: string[];
  waitingReason?: StageWaitingReason;
}

export interface WorkflowTask {
  id: string;
  kind: string;
  owner: string;
  dependsOn?: string[];
  run(): Promise<WorkflowTaskResult>;
}

export interface WorkflowStageResult {
  id: string;
  status: StageExecutionStatus;
  evidence: string[];
  waitingReason?: StageWaitingReason;
}

export interface WorkflowExecutorOptions {
  loopId: string;
  runId: string;
  taskId: string;
  maxParallelTasks: number;
  eventStore: StageEventStore;
  now?: () => Date;
}

export interface WorkflowExecutionResult {
  stages: WorkflowStageResult[];
  events: StageExecutionEvent[];
}

/**
 * Executes only dependency-ready tasks, bounded by maxParallelTasks. Agent
 * invocation remains the host's responsibility; this class owns ordering and
 * append-only timing evidence rather than business-repository writes.
 */
export class WorkflowExecutor {
  private readonly now: () => Date;

  constructor(
    private readonly tasks: WorkflowTask[],
    private readonly options: WorkflowExecutorOptions
  ) {
    this.now = options.now ?? (() => new Date());
    validateTasks(tasks, options.maxParallelTasks);
  }

  async execute(): Promise<WorkflowExecutionResult> {
    const stages = new Map<string, WorkflowStageResult>(
      this.tasks.map((task) => [task.id, { id: task.id, status: 'planned', evidence: [] }])
    );
    const events: StageExecutionEvent[] = [];

    while (true) {
      const ready = this.tasks.filter((task) => {
        const stage = stages.get(task.id)!;
        return stage.status === 'planned' && (task.dependsOn ?? []).every((dependencyId) => {
          const dependency = stages.get(dependencyId)!;
          return dependency.status === 'passed' || dependency.status === 'skipped';
        });
      });

      if (ready.length === 0) break;

      const batch = ready.slice(0, this.options.maxParallelTasks);
      await Promise.all(batch.map((task) => this.runTask(task, stages, events)));
    }

    for (const task of this.tasks) {
      const stage = stages.get(task.id)!;
      if (stage.status !== 'planned') continue;

      const dependencyStages = (task.dependsOn ?? []).map((dependencyId) => stages.get(dependencyId)!);
      const waitingDependency = dependencyStages.find((dependency) => dependency.status === 'waiting');
      stage.status = 'blocked';
      stage.waitingReason = waitingDependency ? 'dependency_waiting' : 'error_blocker';
      await this.emit(task, stage, events, 'blocked');
    }

    return {
      stages: this.tasks.map((task) => stages.get(task.id)!),
      events
    };
  }

  private async runTask(
    task: WorkflowTask,
    stages: Map<string, WorkflowStageResult>,
    events: StageExecutionEvent[]
  ): Promise<void> {
    const stage = stages.get(task.id)!;
    stage.status = 'running';
    await this.emit(task, stage, events, 'entered');
    await this.emit(task, stage, events, 'first_action');

    try {
      const result = await task.run();
      stage.status = result.status;
      stage.evidence = result.evidence ?? [];
      stage.waitingReason = result.waitingReason;
      await this.emit(task, stage, events, eventForStatus(result.status));
    } catch (error) {
      stage.status = 'failed';
      stage.evidence = [error instanceof Error ? error.message : String(error)];
      stage.waitingReason = 'error_blocker';
      await this.emit(task, stage, events, 'failed');
    }
  }

  private async emit(
    task: WorkflowTask,
    stage: WorkflowStageResult,
    events: StageExecutionEvent[],
    event: StageExecutionEvent['event']
  ): Promise<void> {
    const record: StageExecutionEvent = {
      kind: 'StageExecutionEvent',
      version: 1,
      loopId: this.options.loopId,
      runId: this.options.runId,
      taskId: this.options.taskId,
      stageId: task.id,
      stageKind: task.kind,
      owner: task.owner,
      event,
      status: stage.status,
      timestamp: this.now().toISOString(),
      waitingReason: stage.waitingReason,
      evidence: stage.evidence.length > 0 ? stage.evidence : undefined
    };
    events.push(record);
    await this.options.eventStore.append(record);
  }
}

function validateTasks(tasks: WorkflowTask[], maxParallelTasks: number): void {
  if (!Number.isInteger(maxParallelTasks) || maxParallelTasks < 1) {
    throw new Error('maxParallelTasks must be a positive integer');
  }

  const ids = new Set<string>();
  for (const task of tasks) {
    if (!task.id || ids.has(task.id)) throw new Error(`workflow task id must be unique: ${task.id}`);
    ids.add(task.id);
  }

  for (const task of tasks) {
    for (const dependencyId of task.dependsOn ?? []) {
      if (!ids.has(dependencyId)) throw new Error(`workflow dependency is unknown: ${task.id} -> ${dependencyId}`);
      if (dependencyId === task.id) throw new Error(`workflow task cannot depend on itself: ${task.id}`);
    }
  }
}

function eventForStatus(status: WorkflowTaskResult['status']): StageExecutionEvent['event'] {
  if (status === 'passed') return 'completed';
  if (status === 'skipped') return 'skipped';
  if (status === 'waiting') return 'waiting';
  return 'failed';
}
