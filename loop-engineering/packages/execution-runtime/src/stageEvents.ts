import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import {
  GatePassEvidence,
  HarnessEvidenceType,
  StageEvent,
  StageEventInput,
  StageEventKey,
  StageEventType,
  StageTimingProjection,
  StageWaitingReason
} from '../../shared/src/types';

type StageProjectionScope = StageEventKey & Pick<StageEvent, 'stageKind' | 'owner'>;
type TerminalStageEventType = 'passed' | 'failed' | 'blocked' | 'skipped';

const eventTypes = new Set<StageEventType>([
  'entered',
  'first_action',
  'waiting_started',
  'waiting_ended',
  'passed',
  'failed',
  'blocked',
  'skipped'
]);
const terminalEventTypes = new Set<TerminalStageEventType>(['passed', 'failed', 'blocked', 'skipped']);
const waitingReasons = new Set<StageWaitingReason>([
  'human_input',
  'tool_running',
  'external_api',
  'missing_context',
  'approval_required',
  'error_blocker'
]);
const evidenceTypes = new Set<HarnessEvidenceType>([
  'command',
  'file',
  'diff',
  'test',
  'browser',
  'review',
  'human-approval',
  'other'
]);

export function createStageEvent(input: StageEventInput, now = new Date()): StageEvent {
  const event: StageEvent = {
    kind: 'StageEvent',
    version: 1,
    id: randomUUID(),
    loopId: input.loopId,
    runId: input.runId,
    taskId: input.taskId,
    stageId: input.stageId,
    attempt: input.attempt,
    stageKind: input.stageKind,
    owner: input.owner,
    eventType: input.eventType,
    occurredAt: input.occurredAt ?? now.toISOString(),
    waitingReason: input.waitingReason,
    evidence: input.evidence ?? []
  };
  const errors = validateStageEvent(event);
  if (errors.length > 0) throw new Error(`Invalid StageEvent: ${errors.join('; ')}`);
  return event;
}

export class StageEventStore {
  constructor(
    private readonly memoryRoot: string,
    private readonly loopId: string
  ) {}

  filePath(): string {
    return resolveMemoryPath(this.memoryRoot, `memory/loops/${this.loopId}/stage-events.jsonl`);
  }

  async readAll(): Promise<StageEvent[]> {
    const filePath = this.filePath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Invalid StageEvent JSONL at ${filePath}:${index + 1}`);
      }
      const errors = validateStageEvent(value);
      if (errors.length > 0) {
        throw new Error(`Invalid StageEvent at ${filePath}:${index + 1}: ${errors.join('; ')}`);
      }
      return value as StageEvent;
    });
  }

  async append(event: StageEvent): Promise<void> {
    const structuralErrors = validateStageEvent(event);
    if (event.loopId !== this.loopId || structuralErrors.length > 0) {
      throw new Error(
        `Cannot append invalid StageEvent for loop ${this.loopId}: ${structuralErrors.join('; ') || 'loopId mismatch'}`
      );
    }

    const events = await this.readAll();
    if (events.some((item) => item.id === event.id)) {
      throw new Error(`Cannot append duplicate StageEvent id: ${event.id}`);
    }

    const stageEvents = events.filter((item) => sameStage(item, event));
    const attemptEvents = stageEvents.filter((item) => item.attempt === event.attempt);
    const maxAttempt = stageEvents.reduce((maximum, item) => Math.max(maximum, item.attempt), 0);
    if (attemptEvents.length === 0) {
      if (event.attempt !== maxAttempt + 1) {
        throw new Error(`StageEvent attempt must be ${maxAttempt + 1}, received ${event.attempt}`);
      }
      if (maxAttempt > 0) {
        const previousEvents = stageEvents.filter((item) => item.attempt === maxAttempt);
        const previousErrors = validateStageEventSequence(previousEvents);
        const previousTerminal = previousEvents.at(-1)?.eventType;
        if (previousErrors.length > 0 || (previousTerminal !== 'failed' && previousTerminal !== 'blocked')) {
          throw new Error('A new StageEvent attempt requires a valid failed or blocked previous attempt');
        }
      }
    } else if (event.attempt !== maxAttempt) {
      throw new Error(`Cannot append to superseded StageEvent attempt ${event.attempt}`);
    }

    const transitionErrors = validateStageEventSequence([...attemptEvents, event]);
    if (transitionErrors.length > 0) {
      throw new Error(`Invalid StageEvent transition: ${transitionErrors.join('; ')}`);
    }

    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

export function validateStageEventSequence(events: StageEvent[]): string[] {
  if (events.length === 0) return [];

  const errors: string[] = [];
  const first = events[0];
  const ids = new Set<string>();
  let entered = false;
  let firstAction = false;
  let waiting: StageEvent | undefined;
  let terminal = false;
  let previousTime = Number.NEGATIVE_INFINITY;

  events.forEach((event, index) => {
    const position = index + 1;
    const structuralErrors = validateStageEvent(event);
    errors.push(...structuralErrors.map((error) => `Event ${position}: ${error}`));
    if (!sameKey(first, event) || event.stageKind !== first.stageKind || event.owner !== first.owner) {
      errors.push(`Event ${position}: stage identity changed within one attempt`);
    }
    if (ids.has(event.id)) errors.push(`Event ${position}: duplicate event id ${event.id}`);
    ids.add(event.id);

    const occurredAt = Date.parse(event.occurredAt);
    if (Number.isFinite(occurredAt) && occurredAt < previousTime) {
      errors.push(`Event ${position}: occurredAt is earlier than the previous event`);
    }
    if (Number.isFinite(occurredAt)) previousTime = occurredAt;

    if (terminal) {
      errors.push(`Event ${position}: ${event.eventType} occurs after a terminal event`);
      return;
    }

    switch (event.eventType) {
      case 'entered':
        if (entered) errors.push(`Event ${position}: duplicate entered event`);
        if (index !== 0) errors.push(`Event ${position}: entered must be the first event`);
        entered = true;
        break;
      case 'first_action':
        if (!entered) errors.push(`Event ${position}: first_action requires entered`);
        if (firstAction) errors.push(`Event ${position}: duplicate first_action event`);
        if (waiting) errors.push(`Event ${position}: first_action cannot occur while waiting`);
        firstAction = true;
        break;
      case 'waiting_started':
        if (!entered) errors.push(`Event ${position}: waiting_started requires entered`);
        if (waiting) errors.push(`Event ${position}: waiting_started requires the previous wait to end`);
        waiting = event;
        break;
      case 'waiting_ended':
        if (!entered) errors.push(`Event ${position}: waiting_ended requires entered`);
        if (!waiting) {
          errors.push(`Event ${position}: waiting_ended requires waiting_started`);
        } else if (event.waitingReason && event.waitingReason !== waiting.waitingReason) {
          errors.push(`Event ${position}: waitingReason does not match waiting_started`);
        }
        waiting = undefined;
        break;
      default:
        if (!entered) errors.push(`Event ${position}: ${event.eventType} requires entered`);
        if (waiting) errors.push(`Event ${position}: terminal event cannot occur while waiting`);
        terminal = true;
    }
  });

  if (!entered) errors.push('StageEvent sequence is missing entered');
  return errors;
}

export function projectStageTiming(events: StageEvent[], scope: StageProjectionScope): StageTimingProjection {
  const relevant = events.filter((event) => sameKey(event, scope));
  const evidence = relevant.flatMap((event) => event.evidence);
  if (relevant.length === 0) {
    return unmeasuredProjection(scope, evidence, ['No stage events were recorded'], 'missing_instrumentation');
  }

  const errors = validateStageEventSequence(relevant);
  relevant.forEach((event, index) => {
    if (event.stageKind !== scope.stageKind) errors.push(`Event ${index + 1}: stageKind does not match configured stage`);
    if (event.owner !== scope.owner) errors.push(`Event ${index + 1}: owner does not match configured stage`);
  });

  const entered = relevant.find((event) => event.eventType === 'entered');
  const firstAction = relevant.find((event) => event.eventType === 'first_action');
  const terminal = relevant.find(
    (event): event is StageEvent & { eventType: TerminalStageEventType } => isTerminalEventType(event.eventType)
  );
  const waits = collectWaitingIntervals(relevant);
  const waitingReason = waits.at(-1)?.start.waitingReason ?? null;
  if (errors.length > 0) {
    return {
      ...unmeasuredProjection(scope, evidence, errors, waitingReason),
      enteredAt: entered?.occurredAt ?? null,
      firstActionAt: firstAction?.occurredAt ?? null,
      exitedAt: terminal?.occurredAt ?? null
    };
  }

  const lastWait = waits.at(-1);
  const waiting = Boolean(lastWait && lastWait.end === undefined);
  const waitingMs = waiting
    ? null
    : waits.reduce((total, interval) => total + Date.parse(interval.end!.occurredAt) - Date.parse(interval.start.occurredAt), 0);
  const durationMs = terminal && entered ? Date.parse(terminal.occurredAt) - Date.parse(entered.occurredAt) : null;
  return {
    loopId: scope.loopId,
    runId: scope.runId,
    taskId: scope.taskId,
    stageId: scope.stageId,
    attempt: scope.attempt,
    stageKind: scope.stageKind,
    owner: scope.owner,
    status: terminal?.eventType ?? (waiting ? 'waiting' : 'running'),
    valid: true,
    enteredAt: entered?.occurredAt ?? null,
    firstActionAt: firstAction?.occurredAt ?? null,
    exitedAt: terminal?.occurredAt ?? null,
    durationMs,
    activeMs: durationMs === null || waitingMs === null ? null : durationMs - waitingMs,
    waitingMs,
    waitingReason,
    evidence,
    errors: []
  };
}

function validateStageEvent(value: unknown): string[] {
  if (!isRecord(value)) return ['event must be an object'];
  const errors: string[] = [];
  if (value.kind !== 'StageEvent') errors.push('kind must be StageEvent');
  if (value.version !== 1) errors.push('version must be 1');
  for (const field of ['id', 'loopId', 'runId', 'taskId', 'stageId', 'stageKind', 'owner'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) errors.push('attempt must be a positive integer');
  if (typeof value.eventType !== 'string' || !eventTypes.has(value.eventType as StageEventType)) {
    errors.push('eventType is not supported');
  }
  if (!isIsoTimestamp(value.occurredAt)) errors.push('occurredAt must be an ISO timestamp');
  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidence)) {
    errors.push('evidence must contain supported non-empty evidence items');
  }
  if (value.eventType === 'waiting_started') {
    if (typeof value.waitingReason !== 'string' || !waitingReasons.has(value.waitingReason as StageWaitingReason)) {
      errors.push('waiting_started requires a supported waitingReason');
    }
  } else if (
    value.waitingReason !== undefined &&
    (value.eventType !== 'waiting_ended' ||
      typeof value.waitingReason !== 'string' ||
      !waitingReasons.has(value.waitingReason as StageWaitingReason))
  ) {
    errors.push('waitingReason is only valid for waiting events');
  }
  return errors;
}

function collectWaitingIntervals(events: StageEvent[]): Array<{ start: StageEvent; end?: StageEvent }> {
  const intervals: Array<{ start: StageEvent; end?: StageEvent }> = [];
  for (const event of events) {
    if (event.eventType === 'waiting_started') intervals.push({ start: event });
    if (event.eventType === 'waiting_ended' && intervals.length > 0) intervals[intervals.length - 1].end = event;
  }
  return intervals;
}

function unmeasuredProjection(
  scope: StageProjectionScope,
  evidence: GatePassEvidence[],
  errors: string[],
  waitingReason: StageWaitingReason | 'missing_instrumentation' | null
): StageTimingProjection {
  return {
    loopId: scope.loopId,
    runId: scope.runId,
    taskId: scope.taskId,
    stageId: scope.stageId,
    attempt: scope.attempt,
    stageKind: scope.stageKind,
    owner: scope.owner,
    status: 'unmeasured',
    valid: false,
    enteredAt: null,
    firstActionAt: null,
    exitedAt: null,
    durationMs: null,
    activeMs: null,
    waitingMs: null,
    waitingReason,
    evidence,
    errors
  };
}

function sameKey(left: StageEventKey, right: StageEventKey): boolean {
  return (
    left.loopId === right.loopId &&
    left.runId === right.runId &&
    left.taskId === right.taskId &&
    left.stageId === right.stageId &&
    left.attempt === right.attempt
  );
}

function sameStage(left: StageEventKey, right: StageEventKey): boolean {
  return (
    left.loopId === right.loopId &&
    left.runId === right.runId &&
    left.taskId === right.taskId &&
    left.stageId === right.stageId
  );
}

function isEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    evidenceTypes.has(value.type as HarnessEvidenceType) &&
    isNonEmptyString(value.value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isTerminalEventType(value: StageEventType): value is TerminalStageEventType {
  return terminalEventTypes.has(value as TerminalStageEventType);
}
