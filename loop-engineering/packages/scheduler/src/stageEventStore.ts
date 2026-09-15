import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export type StageExecutionStatus = 'planned' | 'running' | 'passed' | 'failed' | 'waiting' | 'skipped' | 'blocked';

export type StageWaitingReason =
  | 'human_input'
  | 'tool_running'
  | 'external_api'
  | 'missing_context'
  | 'approval_required'
  | 'error_blocker'
  | 'dependency_waiting';

export type StageEventType = 'entered' | 'first_action' | 'waiting' | 'completed' | 'failed' | 'skipped' | 'blocked';

export interface StageExecutionEvent {
  kind: 'StageExecutionEvent';
  version: 1;
  loopId: string;
  runId: string;
  taskId: string;
  stageId: string;
  stageKind: string;
  owner: string;
  event: StageEventType;
  status: StageExecutionStatus;
  timestamp: string;
  waitingReason?: StageWaitingReason;
  evidence?: string[];
}

export interface StageEventStore {
  append(event: StageExecutionEvent): Promise<void>;
}

/** Runtime-local, append-only evidence store for workflow stage timing. */
export class JsonlStageEventStore implements StageEventStore {
  constructor(private readonly filePath: string) {}

  async append(event: StageExecutionEvent): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

/** Test and host adapters can inspect emitted events without a filesystem dependency. */
export class InMemoryStageEventStore implements StageEventStore {
  readonly events: StageExecutionEvent[] = [];

  async append(event: StageExecutionEvent): Promise<void> {
    this.events.push(event);
  }
}
