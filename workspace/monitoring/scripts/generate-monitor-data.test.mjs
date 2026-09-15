import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildStageTiming, mergeObservedStages } from './generate-monitor-data.mjs';

test('monitoring includes runtime-observed xigua stages without fabricating unobserved ones', () => {
  const declaredStages = [
    { id: 'requirement-intake', kind: 'intake', owner: 'xiaobai', evidence: 'frontend-delivery.loop.yaml#requirement-intake' }
  ];
  const events = [
    {
      kind: 'StageExecutionEvent',
      loopId: 'frontend-delivery',
      runId: 'run-1',
      stageId: 'xigua-page-write',
      stageKind: 'coding',
      owner: 'xigua-frontend-agent',
      event: 'entered',
      status: 'running',
      timestamp: '2026-09-15T00:00:00.000Z'
    },
    {
      kind: 'StageExecutionEvent',
      loopId: 'frontend-delivery',
      runId: 'run-1',
      stageId: 'xigua-page-write',
      stageKind: 'coding',
      owner: 'xigua-frontend-agent',
      event: 'first_action',
      status: 'running',
      timestamp: '2026-09-15T00:00:00.500Z'
    },
    {
      kind: 'StageExecutionEvent',
      loopId: 'frontend-delivery',
      runId: 'run-1',
      stageId: 'xigua-page-write',
      stageKind: 'coding',
      owner: 'xigua-frontend-agent',
      event: 'completed',
      status: 'passed',
      timestamp: '2026-09-15T00:00:02.000Z',
      evidence: ['src/pages/SimpleLine/index.js']
    }
  ];

  const stages = mergeObservedStages(declaredStages, events, 'frontend-delivery');
  assert.deepEqual(stages.map((stage) => stage.id), ['requirement-intake', 'xigua-page-write']);
  assert.deepEqual(stages.at(-1), {
    id: 'xigua-page-write',
    kind: 'coding',
    owner: 'xigua-frontend-agent',
    evidence: 'stage-events.jsonl'
  });

  const observedTiming = buildStageTiming({ ...stages.at(-1), loopId: 'frontend-delivery' }, events, new Date('2026-09-15T00:00:03.000Z'));
  const unobservedTiming = buildStageTiming({ ...stages[0], loopId: 'frontend-delivery' }, events, new Date('2026-09-15T00:00:03.000Z'));

  assert.equal(observedTiming.status, 'passed');
  assert.equal(observedTiming.durationMs, 2000);
  assert.equal(observedTiming.activeMs, 2000);
  assert.equal(observedTiming.waitingMs, 0);
  assert.equal(unobservedTiming.status, 'unmeasured');
  assert.equal(unobservedTiming.durationMs, null);
});
