import { createHash, randomUUID } from 'node:crypto';
import { appendFile, chmod, mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import {
  ExecutionEvent,
  ExecutionEventActor,
  ExecutionEventInput,
  ExecutionEventType,
  ExecutionTraceProjection,
  GatePassEvidence,
  HarnessEvidenceType,
  JsonRecord
} from '../../shared/src/types';

const defaultMaxInlineBytes = 64 * 1024;
export const executionEventTypeCatalog: ExecutionEventType[] = [
  'gate/decision',
  'context/resolved',
  'prompt/assembled',
  'model/requested',
  'model/completed',
  'tool/call',
  'tool/result',
  'executor/completed',
  'harness/verdict',
  'evaluation/verdict'
];
const executionEventTypes = new Set<ExecutionEventType>(executionEventTypeCatalog);
const executionEventActors = new Set<ExecutionEventActor>(['runtime', 'executor', 'harness', 'evaluator']);
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

export interface ExecutionEventStoreOptions {
  maxInlineBytes?: number;
  now?: () => Date;
}

export class ExecutionEventStore {
  private readonly maxInlineBytes: number;
  private readonly clock: () => Date;

  constructor(
    private readonly memoryRoot: string,
    private readonly projectId: string,
    private readonly loopId: string,
    private readonly runId: string,
    options: ExecutionEventStoreOptions = {}
  ) {
    this.maxInlineBytes = options.maxInlineBytes ?? defaultMaxInlineBytes;
    if (!Number.isInteger(this.maxInlineBytes) || this.maxInlineBytes < 1024) {
      throw new Error('ExecutionEvent maxInlineBytes must be an integer of at least 1024');
    }
    this.clock = options.now ?? (() => new Date());
  }

  filePath(): string {
    return resolveMemoryPath(
      this.memoryRoot,
      `memory/loops/${encodeURIComponent(this.loopId)}/runs/${encodeURIComponent(this.runId)}/execution-events.jsonl`
    );
  }

  async readAll(): Promise<ExecutionEvent[]> {
    const filePath = this.filePath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    const events = lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Invalid ExecutionEvent JSONL at ${filePath}:${index + 1}`);
      }
      const errors = validateExecutionEvent(value);
      if (errors.length > 0) {
        throw new Error(`Invalid ExecutionEvent at ${filePath}:${index + 1}: ${errors.join('; ')}`);
      }
      return value as ExecutionEvent;
    });
    const sequenceErrors = validateExecutionEventSequence(events, this.projectId, this.loopId, this.runId);
    if (sequenceErrors.length > 0) {
      throw new Error(`Invalid ExecutionEvent sequence at ${filePath}: ${sequenceErrors.join('; ')}`);
    }
    return events;
  }

  async append(input: ExecutionEventInput): Promise<ExecutionEvent> {
    if (
      input.projectId !== this.projectId ||
      input.loopId !== this.loopId ||
      input.runId !== this.runId
    ) {
      throw new Error(
        `ExecutionEvent scope does not match store ${this.projectId}/${this.loopId}/${this.runId}`
      );
    }
    const previous = await this.readAll();
    const id = randomUUID();
    const seq = (previous.at(-1)?.seq ?? 0) + 1;
    const occurredAt = input.occurredAt ?? this.clock().toISOString();
    const data = await this.materializeData(input.data ?? {}, seq, id, input.eventType);
    const event: ExecutionEvent = {
      kind: 'ExecutionEvent',
      version: 1,
      id,
      seq,
      projectId: input.projectId,
      loopId: input.loopId,
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stageId,
      attempt: input.attempt,
      actor: input.actor,
      eventType: input.eventType,
      occurredAt,
      data,
      evidence: input.evidence ?? []
    };
    const errors = [
      ...validateExecutionEvent(event),
      ...validateExecutionEventSequence(
        [...previous, event],
        this.projectId,
        this.loopId,
        this.runId
      )
    ];
    if (errors.length > 0) throw new Error(`Cannot append ExecutionEvent: ${errors.join('; ')}`);

    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
    return event;
  }

  private async materializeData(
    value: JsonRecord,
    seq: number,
    eventId: string,
    eventType: ExecutionEventType
  ): Promise<JsonRecord> {
    const serialized = serializeRecord(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes <= this.maxInlineBytes) return JSON.parse(serialized) as JsonRecord;

    const digest = createHash('sha256').update(serialized).digest('hex');
    const directory = path.join(path.dirname(this.filePath()), 'spills');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    const fileName = `${String(seq).padStart(6, '0')}-${eventType.replaceAll('/', '-')}-${eventId}.json`;
    const spillPath = path.join(directory, fileName);
    const handle = await open(spillPath, 'wx', 0o600);
    try {
      await handle.writeFile(`${serialized}\n`, 'utf8');
      await handle.sync();
    } catch (error) {
      await handle.close();
      await unlink(spillPath).catch(() => undefined);
      throw error;
    }
    await handle.close();
    await chmod(spillPath, 0o600);
    return {
      spilled: true,
      digest,
      bytes,
      path: path.relative(this.memoryRoot, spillPath).replaceAll(path.sep, '/')
    };
  }
}

export function projectExecutionTrace(events: ExecutionEvent[]): ExecutionTraceProjection {
  const projectId = events[0]?.projectId ?? '';
  const loopId = events[0]?.loopId ?? '';
  const runId = events[0]?.runId ?? '';
  const errors = validateExecutionEventSequence(events, projectId, loopId, runId);
  return {
    loopId,
    runId,
    valid: errors.length === 0,
    reconstructable: errors.length === 0 && modelRequestsHavePrompt(events),
    modelRequests: count(events, 'model/requested'),
    modelCompletions: count(events, 'model/completed'),
    toolCalls: count(events, 'tool/call'),
    toolResults: count(events, 'tool/result'),
    harnessVerdicts: count(events, 'harness/verdict'),
    evaluationVerdicts: count(events, 'evaluation/verdict'),
    errors
  };
}

export function validateExecutionEventSequence(
  events: ExecutionEvent[],
  expectedProjectId = events[0]?.projectId ?? '',
  expectedLoopId = events[0]?.loopId ?? '',
  expectedRunId = events[0]?.runId ?? ''
): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  const prompts = new Set<string>();
  const requests = new Set<string>();
  const calls = new Set<string>();
  let previousTime = Number.NEGATIVE_INFINITY;

  events.forEach((event, index) => {
    const position = index + 1;
    if (event.seq !== position) errors.push(`Event ${position}: seq must be ${position}`);
    if (
      event.projectId !== expectedProjectId ||
      event.loopId !== expectedLoopId ||
      event.runId !== expectedRunId
    ) {
      errors.push(`Event ${position}: projectId/loopId/runId changed within one execution log`);
    }
    if (ids.has(event.id)) errors.push(`Event ${position}: duplicate id ${event.id}`);
    ids.add(event.id);
    const timestamp = Date.parse(event.occurredAt);
    if (timestamp < previousTime) errors.push(`Event ${position}: occurredAt is earlier than the previous event`);
    previousTime = timestamp;

    const requestId = dataString(event.data, 'requestId');
    const callId = dataString(event.data, 'callId');
    if (event.eventType === 'prompt/assembled') {
      if (!requestId) errors.push(`Event ${position}: prompt/assembled requires data.requestId`);
      else prompts.add(requestId);
    }
    if (event.eventType === 'model/requested') {
      if (!requestId) errors.push(`Event ${position}: model/requested requires data.requestId`);
      else {
        if (!prompts.has(requestId)) errors.push(`Event ${position}: model/requested has no assembled prompt`);
        requests.add(requestId);
      }
    }
    if (event.eventType === 'model/completed') {
      if (!requestId) errors.push(`Event ${position}: model/completed requires data.requestId`);
      else if (!requests.has(requestId)) errors.push(`Event ${position}: model/completed has no model/requested event`);
    }
    if (event.eventType === 'tool/call') {
      if (!callId) errors.push(`Event ${position}: tool/call requires data.callId`);
      else calls.add(callId);
    }
    if (event.eventType === 'tool/result') {
      if (!callId) errors.push(`Event ${position}: tool/result requires data.callId`);
      else if (!calls.has(callId)) errors.push(`Event ${position}: tool/result has no tool/call event`);
    }
  });
  return errors;
}

function validateExecutionEvent(value: unknown): string[] {
  if (!isRecord(value)) return ['event must be an object'];
  const errors: string[] = [];
  if (value.kind !== 'ExecutionEvent') errors.push('kind must be ExecutionEvent');
  if (value.version !== 1) errors.push('version must be 1');
  if (!isNonEmptyString(value.id)) errors.push('id must be a non-empty string');
  if (!Number.isInteger(value.seq) || Number(value.seq) < 1) errors.push('seq must be a positive integer');
  for (const field of ['projectId', 'loopId', 'runId', 'taskId', 'stageId'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) errors.push('attempt must be a positive integer');
  if (typeof value.actor !== 'string' || !executionEventActors.has(value.actor as ExecutionEventActor)) {
    errors.push('actor is not supported');
  }
  if (typeof value.eventType !== 'string' || !executionEventTypes.has(value.eventType as ExecutionEventType)) {
    errors.push('eventType is not supported');
  }
  if (!isIsoTimestamp(value.occurredAt)) errors.push('occurredAt must be an ISO timestamp');
  if (!isRecord(value.data)) errors.push('data must be a JSON object');
  else {
    try {
      serializeRecord(value.data);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidence)) {
    errors.push('evidence must contain supported non-empty evidence items');
  }
  return errors;
}

function modelRequestsHavePrompt(events: ExecutionEvent[]): boolean {
  const prompts = new Set(
    events
      .filter((event) => event.eventType === 'prompt/assembled')
      .map((event) => dataString(event.data, 'requestId'))
      .filter((value): value is string => Boolean(value))
  );
  return events
    .filter((event) => event.eventType === 'model/requested')
    .every((event) => prompts.has(dataString(event.data, 'requestId') ?? ''));
}

function count(events: ExecutionEvent[], eventType: ExecutionEventType): number {
  return events.filter((event) => event.eventType === eventType).length;
}

function serializeRecord(value: JsonRecord): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    throw new Error(`ExecutionEvent data must be JSON serializable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (serialized === undefined || !isRecord(JSON.parse(serialized))) {
    throw new Error('ExecutionEvent data must serialize to a JSON object');
  }
  return serialized;
}

function dataString(data: JsonRecord, field: string): string | undefined {
  const value = data[field];
  return isNonEmptyString(value) ? value : undefined;
}

function isEvidence(value: unknown): value is GatePassEvidence {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    evidenceTypes.has(value.type as HarnessEvidenceType) &&
    isNonEmptyString(value.value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
