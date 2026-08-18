import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import {
  ExecutionEvent,
  GatePassEvidence,
  JsonRecord,
  RequestTimingStageSummary,
  RequestTimingSummary,
  StageEvent,
  StageEventKey,
  StageTimingMetric,
  StageTimingProjection,
  StageWaitingReason,
  TaskEvent,
  TimingAggregationInput,
  TimingDistribution,
  TimingMeasurementStatus,
  TimingMetricWriteResult,
  TimingStageDefinition
} from '../../shared/src/types';
import { projectStageTiming } from './stageEvents';

const terminalStatuses = new Set<StageTimingProjection['status']>(['passed', 'failed', 'blocked', 'skipped']);
const waitingReasons: StageWaitingReason[] = [
  'human_input',
  'tool_running',
  'external_api',
  'missing_context',
  'approval_required',
  'error_blocker'
];
const minimumPercentileSamples = 2;

export function stageTimingSourceKey(scope: StageEventKey): string {
  return [scope.loopId, scope.runId, scope.taskId, scope.stageId, String(scope.attempt)]
    .map((value) => encodeURIComponent(value))
    .join('/');
}

export function stageTimingMetricFromProjection(projection: StageTimingProjection): StageTimingMetric | null {
  if (
    !projection.valid ||
    !terminalStatuses.has(projection.status) ||
    !isIsoTimestamp(projection.enteredAt) ||
    !isIsoTimestamp(projection.exitedAt) ||
    !isNonNegativeFinite(projection.durationMs) ||
    !isNonNegativeFinite(projection.activeMs) ||
    !isNonNegativeFinite(projection.waitingMs)
  ) {
    return null;
  }

  return {
    ...projection,
    kind: 'StageTimingMetric',
    version: 1,
    sourceKey: stageTimingSourceKey(projection),
    measurementStatus: 'measured',
    valid: true,
    waitingByReason: normalizeWaitingByReason(projection.waitingByReason, projection.waitingReason, projection.waitingMs)
  };
}

export class StageTimingMetricStore {
  constructor(
    private readonly memoryRoot: string,
    private readonly loopId: string
  ) {}

  filePath(): string {
    return resolveMemoryPath(this.memoryRoot, `memory/loops/${this.loopId}/metrics.jsonl`);
  }

  async readAll(): Promise<StageTimingMetric[]> {
    const filePath = this.filePath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    const metrics: StageTimingMetric[] = [];
    lines.forEach((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Invalid metrics JSONL at ${filePath}:${index + 1}`);
      }
      if (!isStageTimingMetric(value)) return;
      const errors = validateStageTimingMetric(value);
      if (errors.length > 0) {
        throw new Error(`Invalid StageTimingMetric at ${filePath}:${index + 1}: ${errors.join('; ')}`);
      }
      metrics.push(value);
    });
    return metrics;
  }

  async append(projection: StageTimingProjection | null): Promise<TimingMetricWriteResult> {
    if (!projection) return { status: 'skipped', reason: 'stage timing projection is unavailable' };
    const metric = stageTimingMetricFromProjection(projection);
    if (!metric) {
      return {
        status: 'skipped',
        sourceKey: stageTimingSourceKey(projection),
        reason: 'stage timing is incomplete or invalid'
      };
    }

    const existing = await this.readAll();
    if (existing.some((item) => item.sourceKey === metric.sourceKey)) {
      return { status: 'duplicate', sourceKey: metric.sourceKey };
    }

    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(metric)}\n`, 'utf8');
    return { status: 'written', sourceKey: metric.sourceKey };
  }
}

export function validateStageTimingMetric(value: unknown): string[] {
  if (!isRecord(value)) return ['metric must be an object'];
  const errors: string[] = [];
  if (value.kind !== 'StageTimingMetric') errors.push('kind must be StageTimingMetric');
  if (value.version !== 1) errors.push('version must be 1');
  if (value.measurementStatus !== 'measured') errors.push('measurementStatus must be measured');
  for (const field of ['sourceKey', 'loopId', 'runId', 'taskId', 'stageId', 'stageKind', 'owner'] as const) {
    if (!isNonEmptyString(value[field])) errors.push(`${field} must be a non-empty string`);
  }
  if (!Number.isInteger(value.attempt) || Number(value.attempt) < 1) errors.push('attempt must be a positive integer');
  if (!terminalStatuses.has(value.status as StageTimingProjection['status'])) errors.push('status must be terminal');
  if (value.valid !== true) errors.push('valid must be true');
  for (const field of ['enteredAt', 'exitedAt'] as const) {
    if (!isIsoTimestamp(value[field])) errors.push(`${field} must be an ISO timestamp`);
  }
  for (const field of ['firstActionAt'] as const) {
    if (value[field] !== null && !isIsoTimestamp(value[field])) errors.push(`${field} must be an ISO timestamp or null`);
  }
  for (const field of ['durationMs', 'activeMs', 'waitingMs'] as const) {
    if (!isNonNegativeFinite(value[field])) errors.push(`${field} must be a non-negative number`);
  }
  if (!isWaitingByReason(value.waitingByReason)) errors.push('waitingByReason must contain supported durations');
  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidence)) errors.push('evidence is invalid');
  if (!Array.isArray(value.errors) || !value.errors.every(isNonEmptyString)) errors.push('errors must be an array of strings');
  return errors;
}

export function aggregateRequestTiming(input: TimingAggregationInput): RequestTimingSummary | null {
  return aggregateRequestTimings(input)[0] ?? null;
}

export function aggregateRequestTimings(input: TimingAggregationInput): RequestTimingSummary[] {
  const metrics = deduplicateMetrics(input.metrics ?? []);
  const groups = collectRequestGroups(input.loopId, input.taskEvents ?? [], input.stageEvents, metrics);
  return [...groups.values()]
    .sort((left, right) => `${left.taskId}/${left.runId ?? ''}`.localeCompare(`${right.taskId}/${right.runId ?? ''}`))
    .map((group) => buildRequestSummary(input, group, metrics));
}

interface RequestGroup {
  taskId: string;
  runId: string | null;
}

interface StageAttemptTiming {
  attempt: number;
  measurementStatus: TimingMeasurementStatus;
  status: StageTimingProjection['status'];
  enteredAt: string | null;
  firstActionAt: string | null;
  exitedAt: string | null;
  durationMs: number | null;
  activeMs: number | null;
  waitingMs: number | null;
  waitingByReason: Partial<Record<StageWaitingReason, number>>;
  errors: string[];
}

function buildRequestSummary(
  input: TimingAggregationInput,
  group: RequestGroup,
  metrics: StageTimingMetric[]
): RequestTimingSummary {
  const taskEvents = (input.taskEvents ?? []).filter((event) => event.taskId === group.taskId);
  const stageEvents = input.stageEvents.filter(
    (event) => event.taskId === group.taskId && (group.runId === null || event.runId === group.runId)
  );
  const executionEvents = (input.executionEvents ?? []).filter(
    (event) => event.taskId === group.taskId && (group.runId === null || event.runId === group.runId)
  );
  const stageDefinitions = mergeStageDefinitions(input.stages ?? [], stageEvents, metrics, group);
  const stages = stageDefinitions.map((definition) =>
    buildStageSummary(definition, stageEvents, metrics, group)
  );
  const measuredStageCount = stages.filter((stage) => stage.status === 'measured').length;
  const status = requestStatus(stages, input.sourceErrors ?? []);
  const durations = stages.flatMap((stage) => stageAttemptDurations(stage, stageEvents, metrics, group));
  const firstActions = stages
    .flatMap((stage) => stageAttemptTimes(stage, 'firstActionAt', stageEvents, metrics, group))
    .sort();
  const entered = stages
    .flatMap((stage) => stageAttemptTimes(stage, 'enteredAt', stageEvents, metrics, group))
    .sort();
  const exited = stages
    .flatMap((stage) => stageAttemptTimes(stage, 'exitedAt', stageEvents, metrics, group))
    .sort();
  const failureReasons = unique([
    ...stages.flatMap((stage) => stage.failureReasons),
    ...executionFailureReasons(executionEvents)
  ]);
  const errors = unique([
    ...(input.sourceErrors ?? []),
    ...stages.flatMap((stage) => stage.errors)
  ]);
  const stageDurationEntries = stages
    .filter((stage) => stage.durationMs !== null)
    .map((stage) => ({ stageId: stage.stageId, durationMs: stage.durationMs! }));
  const bottleneck = stageDurationEntries.sort((left, right) => right.durationMs - left.durationMs)[0];

  return {
    kind: 'RequestTimingSummary',
    version: 1,
    loopId: input.loopId,
    runId: group.runId,
    taskId: group.taskId,
    taskState: taskEvents.at(-1)?.state ?? null,
    status,
    enteredAt: entered[0] ?? null,
    firstActionAt: firstActions[0] ?? null,
    exitedAt: exited.at(-1) ?? null,
    stageCount: stages.length,
    measuredStageCount,
    measurementRate: stages.length === 0 ? 0 : measuredStageCount / stages.length,
    durationMs: sumNullable(stages.map((stage) => stage.durationMs)),
    activeMs: sumNullable(stages.map((stage) => stage.activeMs)),
    waitingMs: sumNullable(stages.map((stage) => stage.waitingMs)),
    waitingByReason: sumWaitingByReason(stages.map((stage) => stage.waitingByReason)),
    distribution: distribution(durations),
    retryCount: stages.reduce((total, stage) => total + stage.retryCount, 0),
    bottleneckStageId: bottleneck?.stageId ?? null,
    failureReasons,
    errors,
    evidence: [],
    stages
  };
}

function buildStageSummary(
  definition: TimingStageDefinition,
  stageEvents: StageEvent[],
  metrics: StageTimingMetric[],
  group: RequestGroup
): RequestTimingStageSummary {
  const matchingMetrics = metrics.filter(
    (metric) => metric.taskId === group.taskId && metric.stageId === definition.id && metric.runId === group.runId
  );
  const rawAttempts = stageEvents
    .filter((event) => event.stageId === definition.id)
    .map((event) => event.attempt);
  const attempts = [...new Set([...matchingMetrics.map((metric) => metric.attempt), ...rawAttempts])].sort((a, b) => a - b);
  const timings = attempts.map((attempt) => {
    const metric = matchingMetrics.find((item) => item.attempt === attempt);
    if (metric) return metricAttemptTiming(metric);
    const events = stageEvents.filter((event) => event.stageId === definition.id && event.attempt === attempt);
    return projectionAttemptTiming(
      events,
      {
        loopId: group.runId === null ? events[0]?.loopId ?? '' : events[0]?.loopId ?? '',
        runId: group.runId ?? events[0]?.runId ?? '',
        taskId: group.taskId,
        stageId: definition.id,
        attempt,
        stageKind: definition.kind,
        owner: definition.owner
      }
    );
  });
  const measured = timings.filter((timing) => timing.measurementStatus === 'measured');
  const invalid = timings.some((timing) => timing.measurementStatus === 'invalid');
  const status: TimingMeasurementStatus = invalid
    ? 'invalid'
    : attempts.length === 0
      ? 'unmeasured'
      : measured.length === attempts.length
        ? 'measured'
        : measured.length > 0
          ? 'partial'
          : 'unmeasured';
  const durations = measured.map((timing) => timing.durationMs).filter(isNumber);
  return {
    stageId: definition.id,
    stageKind: definition.kind,
    owner: definition.owner,
    status,
    attempts: attempts.length,
    measuredAttempts: measured.length,
    retryCount: Math.max(0, attempts.length - 1),
    durationMs: sumNullable(measured.map((timing) => timing.durationMs)),
    activeMs: sumNullable(measured.map((timing) => timing.activeMs)),
    waitingMs: sumNullable(measured.map((timing) => timing.waitingMs)),
    waitingByReason: sumWaitingByReason(measured.map((timing) => timing.waitingByReason)),
    distribution: distribution(durations),
    failureReasons: unique(
      timings
        .filter((timing) => timing.status === 'failed' || timing.status === 'blocked')
        .map((timing) => `${definition.id} attempt ${timing.attempt}: ${timing.status}`)
    ),
    errors: unique(timings.flatMap((timing) => timing.errors))
  };
}

function metricAttemptTiming(metric: StageTimingMetric): StageAttemptTiming {
  return {
    attempt: metric.attempt,
    measurementStatus: 'measured',
    status: metric.status,
    enteredAt: metric.enteredAt,
    firstActionAt: metric.firstActionAt,
    exitedAt: metric.exitedAt,
    durationMs: metric.durationMs,
    activeMs: metric.activeMs,
    waitingMs: metric.waitingMs,
    waitingByReason: metric.waitingByReason,
    errors: metric.errors
  };
}

function projectionAttemptTiming(
  events: StageEvent[],
  scope: StageEventKey & { stageKind: string; owner: string }
): StageAttemptTiming {
  const projection = projectStageTiming(events, scope);
  const measured = projection.valid && terminalStatuses.has(projection.status) && stageTimingMetricFromProjection(projection);
  return {
    attempt: scope.attempt,
    measurementStatus: measured ? 'measured' : events.length === 0 ? 'unmeasured' : projection.valid ? 'unmeasured' : 'invalid',
    status: projection.status,
    enteredAt: projection.enteredAt,
    firstActionAt: projection.firstActionAt,
    exitedAt: projection.exitedAt,
    durationMs: measured ? projection.durationMs : null,
    activeMs: measured ? projection.activeMs : null,
    waitingMs: measured ? projection.waitingMs : null,
    waitingByReason: measured ? projection.waitingByReason : {},
    errors: projection.errors
  };
}

function mergeStageDefinitions(
  configured: TimingStageDefinition[],
  stageEvents: StageEvent[],
  metrics: StageTimingMetric[],
  group: RequestGroup
): TimingStageDefinition[] {
  const definitions = new Map(configured.map((stage) => [stage.id, stage]));
  for (const event of stageEvents) {
    if (event.taskId !== group.taskId || (group.runId !== null && event.runId !== group.runId)) continue;
    if (!definitions.has(event.stageId)) {
      definitions.set(event.stageId, { id: event.stageId, kind: event.stageKind, owner: event.owner });
    }
  }
  for (const metric of metrics) {
    if (metric.taskId !== group.taskId || metric.runId !== group.runId) continue;
    if (!definitions.has(metric.stageId)) {
      definitions.set(metric.stageId, { id: metric.stageId, kind: metric.stageKind, owner: metric.owner });
    }
  }
  return [...definitions.values()];
}

function collectRequestGroups(
  loopId: string,
  taskEvents: TaskEvent[],
  stageEvents: StageEvent[],
  metrics: StageTimingMetric[]
): Map<string, RequestGroup> {
  const groups = new Map<string, RequestGroup>();
  const add = (taskId: string, runId: string | null): void => {
    if (!taskId) return;
    const key = `${taskId}\u0000${runId ?? ''}`;
    if (!groups.has(key)) groups.set(key, { taskId, runId });
  };
  for (const event of taskEvents) {
    const runId = taskRunId(taskEvents.filter((candidate) => candidate.taskId === event.taskId));
    add(event.taskId, runId);
  }
  for (const event of stageEvents) {
    if (event.loopId === loopId) add(event.taskId, event.runId);
  }
  for (const metric of metrics) {
    if (metric.loopId === loopId) add(metric.taskId, metric.runId);
  }
  return groups;
}

function taskRunId(events: TaskEvent[]): string | null {
  const created = events.find((event) => event.eventType === 'task/created');
  const request = isRecord(created?.data.request) ? created?.data.request : undefined;
  return stringValue(request?.runId) ?? stringValue(created?.data.runId) ?? null;
}

function executionFailureReasons(events: ExecutionEvent[]): string[] {
  const reasons: string[] = [];
  for (const event of events) {
    for (const field of ['reason', 'reasons', 'blockingReasons'] as const) {
      const value = event.data[field];
      if (typeof value === 'string') reasons.push(value);
      if (Array.isArray(value)) reasons.push(...value.filter(isNonEmptyString));
    }
  }
  return reasons;
}

function requestStatus(stages: RequestTimingStageSummary[], sourceErrors: string[]): TimingMeasurementStatus {
  if (sourceErrors.length > 0 || stages.some((stage) => stage.status === 'invalid')) return 'invalid';
  const measured = stages.filter((stage) => stage.status === 'measured').length;
  if (stages.length === 0 || measured === 0) return 'unmeasured';
  return measured === stages.length ? 'measured' : 'partial';
}

function distribution(values: number[]): TimingDistribution {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return {
    sampleCount: sorted.length,
    averageMs: sorted.length === 0 ? null : sorted.reduce((total, value) => total + value, 0) / sorted.length,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95)
  };
}

export function percentile(values: number[], ratio: number): number | null {
  if (values.length < minimumPercentileSamples) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (sorted.length - 1) * ratio;
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower);
}

function stageAttemptDurations(
  stage: RequestTimingStageSummary,
  stageEvents: StageEvent[],
  metrics: StageTimingMetric[],
  group: RequestGroup
): number[] {
  const metricValues = metrics
    .filter((metric) => metric.taskId === group.taskId && metric.runId === group.runId && metric.stageId === stage.stageId)
    .map((metric) => metric.durationMs)
    .filter(isNumber);
  if (metricValues.length > 0) return metricValues;
  return stageEvents
    .filter((event) => event.taskId === group.taskId && event.stageId === stage.stageId && (group.runId === null || event.runId === group.runId))
    .reduce<number[]>((durations, event) => {
      if (event.eventType !== 'passed' && event.eventType !== 'failed' && event.eventType !== 'blocked' && event.eventType !== 'skipped') return durations;
      const attemptEvents = stageEvents.filter(
        (candidate) => candidate.taskId === event.taskId && candidate.stageId === event.stageId && candidate.attempt === event.attempt
      );
      const projection = projectStageTiming(attemptEvents, {
        loopId: event.loopId,
        runId: event.runId,
        taskId: event.taskId,
        stageId: event.stageId,
        attempt: event.attempt,
        stageKind: event.stageKind,
        owner: event.owner
      });
      if (projection.valid && projection.durationMs !== null) durations.push(projection.durationMs);
      return durations;
    }, []);
}

function stageAttemptTimes(
  stage: RequestTimingStageSummary,
  field: 'enteredAt' | 'firstActionAt' | 'exitedAt',
  stageEvents: StageEvent[],
  metrics: StageTimingMetric[],
  group: RequestGroup
): string[] {
  const metricValues = metrics
    .filter((metric) => metric.taskId === group.taskId && metric.runId === group.runId && metric.stageId === stage.stageId)
    .map((metric) => metric[field])
    .filter(isIsoTimestamp);
  if (metricValues.length > 0) return metricValues;
  const attempts = [...new Set(
    stageEvents
      .filter((event) => event.taskId === group.taskId && event.stageId === stage.stageId && (group.runId === null || event.runId === group.runId))
      .map((event) => event.attempt)
  )];
  return attempts
    .map((attempt) => {
      const events = stageEvents.filter(
        (event) => event.taskId === group.taskId && event.stageId === stage.stageId && event.attempt === attempt &&
          (group.runId === null || event.runId === group.runId)
      );
      const event = events[0];
      if (!event) return null;
      const projection = projectStageTiming(events, {
        loopId: event.loopId,
        runId: event.runId,
        taskId: event.taskId,
        stageId: event.stageId,
        attempt,
        stageKind: event.stageKind,
        owner: event.owner
      });
      return projection[field];
    })
    .filter(isIsoTimestamp);
}

function deduplicateMetrics(metrics: StageTimingMetric[]): StageTimingMetric[] {
  const uniqueMetrics = new Map<string, StageTimingMetric>();
  for (const metric of metrics) {
    if (metric.kind === 'StageTimingMetric' && metric.version === 1) uniqueMetrics.set(metric.sourceKey, metric);
  }
  return [...uniqueMetrics.values()];
}

function sumNullable(values: Array<number | null>): number | null {
  const measured = values.filter(isNumber);
  return measured.length === 0 ? null : measured.reduce((total, value) => total + value, 0);
}

function sumWaitingByReason(values: Array<Partial<Record<StageWaitingReason, number>>>): Partial<Record<StageWaitingReason, number>> {
  return values.reduce<Partial<Record<StageWaitingReason, number>>>((totals, value) => {
    for (const reason of waitingReasons) {
      const duration = value[reason];
      if (isNumber(duration)) totals[reason] = (totals[reason] ?? 0) + duration;
    }
    return totals;
  }, {});
}

function normalizeWaitingByReason(
  value: Partial<Record<StageWaitingReason, number>> | undefined,
  fallbackReason: StageTimingProjection['waitingReason'],
  waitingMs: number
): Partial<Record<StageWaitingReason, number>> {
  if (value && isWaitingByReason(value)) return value;
  if (isWaitingReason(fallbackReason) && waitingMs > 0) return { [fallbackReason]: waitingMs };
  return {};
}

function isStageTimingMetric(value: unknown): value is StageTimingMetric {
  return isRecord(value) && value.kind === 'StageTimingMetric';
}

function isWaitingByReason(value: unknown): value is Partial<Record<StageWaitingReason, number>> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([reason, duration]) => waitingReasons.includes(reason as StageWaitingReason) && isNonNegativeFinite(duration));
}

function isWaitingReason(value: unknown): value is StageWaitingReason {
  return typeof value === 'string' && waitingReasons.includes(value as StageWaitingReason);
}

function isEvidence(value: unknown): value is GatePassEvidence {
  return isRecord(value) && isNonEmptyString(value.type) && isNonEmptyString(value.value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeFinite(value: unknown): value is number {
  return isNumber(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringValue(value: unknown): string | null {
  return isNonEmptyString(value) ? value : null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(isNonEmptyString))];
}
