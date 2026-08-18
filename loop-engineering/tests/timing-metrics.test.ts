import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  createStageEvent,
  projectStageTiming
} from '../packages/execution-runtime/src/stageEvents';
import {
  aggregateRequestTiming,
  percentile,
  stageTimingMetricFromProjection,
  StageTimingMetricStore
} from '../packages/execution-runtime/src/timingMetrics';
import {
  StageEvent,
  StageEventKey,
  TaskEvent,
  TimingStageDefinition
} from '../packages/shared/src/types';

const baseScope = {
  loopId: 'loop-timing',
  runId: 'run-timing',
  taskId: 'task-timing',
  stageId: 'coding',
  attempt: 1,
  stageKind: 'coding',
  owner: 'generator'
};

function stageEvents(
  scope: typeof baseScope,
  entries: Array<{ eventType: Parameters<typeof createStageEvent>[0]['eventType']; at: string; waitingReason?: Parameters<typeof createStageEvent>[0]['waitingReason'] }>
): StageEvent[] {
  return entries.map((entry) => createStageEvent({ ...scope, ...entry, occurredAt: entry.at }));
}

function taskEvent(taskId: string, eventType: TaskEvent['eventType'], state: TaskEvent['state'], seq: number): TaskEvent {
  return {
    kind: 'TaskEvent',
    version: 1,
    id: `task-event-${seq}`,
    seq,
    taskId,
    eventType,
    occurredAt: `2026-08-18T00:00:0${seq}.000Z`,
    actor: 'runtime',
    state,
    data: seq === 1 ? { request: { runId: 'run-timing' }, loopId: 'loop-timing' } : {},
    evidence: []
  };
}

function metricFor(events: StageEvent[], scope: typeof baseScope) {
  const projection = projectStageTiming(events, scope);
  const metric = stageTimingMetricFromProjection(projection);
  assert(metric, projection.errors.join('\n'));
  return metric;
}

test('stage timing metrics preserve waiting reasons and append idempotently beside simulation records', async () => {
  const events = stageEvents(baseScope, [
    { eventType: 'entered', at: '2026-08-18T00:00:00.000Z' },
    { eventType: 'first_action', at: '2026-08-18T00:00:01.000Z' },
    { eventType: 'waiting_started', at: '2026-08-18T00:00:02.000Z', waitingReason: 'tool_running' },
    { eventType: 'waiting_ended', at: '2026-08-18T00:00:07.000Z', waitingReason: 'tool_running' },
    { eventType: 'waiting_started', at: '2026-08-18T00:00:08.000Z', waitingReason: 'human_input' },
    { eventType: 'waiting_ended', at: '2026-08-18T00:00:10.000Z', waitingReason: 'human_input' },
    { eventType: 'passed', at: '2026-08-18T00:00:12.000Z' }
  ]);
  const projection = projectStageTiming(events, baseScope);
  assert.equal(projection.valid, true);
  assert.equal(projection.durationMs, 12_000);
  assert.equal(projection.waitingMs, 7_000);
  assert.equal(projection.activeMs, 5_000);
  assert.deepEqual(projection.waitingByReason, { tool_running: 5_000, human_input: 2_000 });

  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'timing-metric-store-'));
  const metricPath = path.join(memoryRoot, 'loops', baseScope.loopId, 'metrics.jsonl');
  await mkdir(path.dirname(metricPath), { recursive: true });
  await writeFile(metricPath, `${JSON.stringify({ runId: 'sim-1', mode: 'simulation', stages: 1 })}\n`, 'utf8');
  const store = new StageTimingMetricStore(memoryRoot, baseScope.loopId);
  const first = await store.append(projection);
  const second = await store.append(projection);
  assert.equal(first.status, 'written');
  assert.equal(second.status, 'duplicate');
  assert.equal((await store.readAll()).length, 1);
});

test('invalid and open stage streams remain unmeasured and never become metrics', () => {
  const entered = createStageEvent({ ...baseScope, eventType: 'entered', occurredAt: '2026-08-18T00:00:02.000Z' });
  const outOfOrder = createStageEvent({ ...baseScope, eventType: 'first_action', occurredAt: '2026-08-18T00:00:01.000Z' });
  const projection = projectStageTiming([entered, outOfOrder], baseScope);
  assert.equal(projection.valid, false);
  assert.equal(projection.status, 'unmeasured');
  assert.equal(stageTimingMetricFromProjection(projection), null);

  const openWait = stageEvents(baseScope, [
    { eventType: 'entered', at: '2026-08-18T00:00:00.000Z' },
    { eventType: 'waiting_started', at: '2026-08-18T00:00:01.000Z', waitingReason: 'approval_required' }
  ]);
  const openProjection = projectStageTiming(openWait, baseScope);
  assert.equal(openProjection.status, 'unmeasured');
  assert.equal(openProjection.valid, false);
  assert.equal(openProjection.durationMs, null);
  assert.match(openProjection.errors.join('\n'), /open wait/);
  assert.equal(stageTimingMetricFromProjection(openProjection), null);
});

test('metric write failures are isolated from the source projection', async () => {
  const events = stageEvents(baseScope, [
    { eventType: 'entered', at: '2026-08-18T00:00:00.000Z' },
    { eventType: 'passed', at: '2026-08-18T00:00:01.000Z' }
  ]);
  const projection = projectStageTiming(events, baseScope);
  const memoryRoot = await mkdtemp(path.join(tmpdir(), 'timing-metric-failure-'));
  await mkdir(path.join(memoryRoot, 'loops', baseScope.loopId, 'metrics.jsonl'), { recursive: true });
  await assert.rejects(
    () => new StageTimingMetricStore(memoryRoot, baseScope.loopId).append(projection),
    /EISDIR|directory/
  );
  assert.equal(projection.status, 'passed');
  assert.equal(projection.durationMs, 1_000);
});

test('request timing groups retries, waiting reasons, failures, bottlenecks, and distributions', () => {
  const attemptOneScope = { ...baseScope, attempt: 1 };
  const attemptTwoScope = { ...baseScope, attempt: 2 };
  const reviewScope = {
    ...baseScope,
    stageId: 'review',
    stageKind: 'review',
    owner: 'evaluator',
    attempt: 1
  };
  const codingAttemptOne = stageEvents(attemptOneScope, [
    { eventType: 'entered', at: '2026-08-18T00:00:00.000Z' },
    { eventType: 'failed', at: '2026-08-18T00:00:10.000Z' }
  ]);
  const codingAttemptTwo = stageEvents(attemptTwoScope, [
    { eventType: 'entered', at: '2026-08-18T00:00:20.000Z' },
    { eventType: 'first_action', at: '2026-08-18T00:00:21.000Z' },
    { eventType: 'waiting_started', at: '2026-08-18T00:00:22.000Z', waitingReason: 'tool_running' },
    { eventType: 'waiting_ended', at: '2026-08-18T00:00:27.000Z', waitingReason: 'tool_running' },
    { eventType: 'passed', at: '2026-08-18T00:00:50.000Z' }
  ]);
  const review = stageEvents(reviewScope, [
    { eventType: 'entered', at: '2026-08-18T00:01:00.000Z' },
    { eventType: 'passed', at: '2026-08-18T00:01:20.000Z' }
  ]);
  const allStageEvents = [...codingAttemptOne, ...codingAttemptTwo, ...review];
  const taskEvents = [
    taskEvent('task-timing', 'task/created', 'created', 1),
    taskEvent('task-timing', 'task/running', 'running', 2)
  ];
  const executionEvents = [{
    kind: 'ExecutionEvent' as const,
    version: 1 as const,
    id: 'execution-failure',
    seq: 1,
    loopId: 'loop-timing',
    runId: 'run-timing',
    taskId: 'task-timing',
    stageId: 'coding',
    attempt: 1,
    actor: 'runtime' as const,
    eventType: 'executor/completed' as const,
    occurredAt: '2026-08-18T00:00:10.000Z',
    data: { reason: 'compiler failed' },
    evidence: []
  }];
  const stages: TimingStageDefinition[] = [
    { id: 'coding', kind: 'coding', owner: 'generator' },
    { id: 'review', kind: 'review', owner: 'evaluator' },
    { id: 'missing', kind: 'verification', owner: 'evaluator' }
  ];
  const summary = aggregateRequestTiming({
    loopId: 'loop-timing',
    taskEvents,
    stageEvents: allStageEvents,
    executionEvents,
    metrics: [
      metricFor(codingAttemptOne, attemptOneScope),
      metricFor(codingAttemptTwo, attemptTwoScope),
      metricFor(review, reviewScope)
    ],
    stages
  });

  assert(summary);
  assert.equal(summary.status, 'partial');
  assert.equal(summary.stageCount, 3);
  assert.equal(summary.measuredStageCount, 2);
  assert.equal(summary.durationMs, 60_000);
  assert.equal(summary.activeMs, 55_000);
  assert.equal(summary.waitingMs, 5_000);
  assert.deepEqual(summary.waitingByReason, { tool_running: 5_000 });
  assert.equal(summary.retryCount, 1);
  assert.equal(summary.bottleneckStageId, 'coding');
  assert.deepEqual(summary.distribution, {
    sampleCount: 3,
    averageMs: 20_000,
    p50Ms: 20_000,
    p95Ms: 29_000
  });
  assert.match(summary.failureReasons.join('\n'), /compiler failed/);
  assert.equal(summary.stages.find((stage) => stage.stageId === 'missing')?.status, 'unmeasured');
  assert.equal(percentile([10_000], 0.5), null);
  assert.equal(percentile([], 0.95), null);
});
