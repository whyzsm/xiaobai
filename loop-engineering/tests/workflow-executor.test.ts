import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { InMemoryStageEventStore, JsonlStageEventStore } from '../packages/scheduler/src/stageEventStore';
import { WorkflowExecutor, WorkflowTask } from '../packages/scheduler/src/workflowExecutor';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

test('WorkflowExecutor bounds independent tasks and waits for passed or skipped dependencies', async () => {
  const eventStore = new InMemoryStageEventStore();
  const firstStarted = deferred();
  const secondStarted = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  const starts: string[] = [];
  let active = 0;
  let maxActive = 0;

  const tasks: WorkflowTask[] = [
    {
      id: 'first',
      kind: 'evidence',
      owner: 'agent-a',
      run: async () => {
        starts.push('first');
        active += 1;
        maxActive = Math.max(maxActive, active);
        firstStarted.resolve();
        await releaseFirst.promise;
        active -= 1;
        return { status: 'passed' };
      }
    },
    {
      id: 'second',
      kind: 'evidence',
      owner: 'agent-b',
      run: async () => {
        starts.push('second');
        active += 1;
        maxActive = Math.max(maxActive, active);
        secondStarted.resolve();
        await releaseSecond.promise;
        active -= 1;
        return { status: 'skipped' };
      }
    },
    {
      id: 'dependent',
      kind: 'coding',
      owner: 'agent-c',
      dependsOn: ['first', 'second'],
      run: async () => {
        starts.push('dependent');
        return { status: 'passed' };
      }
    }
  ];

  const execution = new WorkflowExecutor(tasks, {
    loopId: 'frontend-delivery',
    runId: 'run-concurrency',
    taskId: 'task-concurrency',
    maxParallelTasks: 2,
    eventStore
  }).execute();

  await Promise.all([firstStarted.promise, secondStarted.promise]);
  assert.equal(maxActive, 2);
  assert.equal(starts.includes('dependent'), false);

  releaseFirst.resolve();
  releaseSecond.resolve();
  const result = await execution;

  assert.deepEqual(result.stages.map((stage) => [stage.id, stage.status]), [
    ['first', 'passed'],
    ['second', 'skipped'],
    ['dependent', 'passed']
  ]);
  assert.ok(starts.indexOf('dependent') > starts.indexOf('first'));
  assert.ok(starts.indexOf('dependent') > starts.indexOf('second'));
  assert.ok(
    result.events.findIndex((event) => event.stageId === 'dependent' && event.event === 'entered')
      > result.events.findIndex((event) => event.stageId === 'first' && event.event === 'completed')
  );
  assert.ok(
    result.events.findIndex((event) => event.stageId === 'dependent' && event.event === 'entered')
      > result.events.findIndex((event) => event.stageId === 'second' && event.event === 'skipped')
  );
});

test('WorkflowExecutor marks only downstream stages blocked when a dependency is waiting', async () => {
  const eventStore = new InMemoryStageEventStore();
  let downstreamRan = false;
  const result = await new WorkflowExecutor([
    {
      id: 'api-contract',
      kind: 'external-wait',
      owner: 'xigua-frontend-agent',
      run: async () => ({ status: 'waiting', waitingReason: 'missing_context' })
    },
    {
      id: 'api-wiring',
      kind: 'coding',
      owner: 'xigua-frontend-agent',
      dependsOn: ['api-contract'],
      run: async () => {
        downstreamRan = true;
        return { status: 'passed' };
      }
    }
  ], {
    loopId: 'frontend-delivery',
    runId: 'run-waiting',
    taskId: 'task-waiting',
    maxParallelTasks: 1,
    eventStore
  }).execute();

  assert.equal(downstreamRan, false);
  assert.deepEqual(result.stages.map((stage) => [stage.id, stage.status, stage.waitingReason]), [
    ['api-contract', 'waiting', 'missing_context'],
    ['api-wiring', 'blocked', 'dependency_waiting']
  ]);
  assert.deepEqual(eventStore.events.map((event) => [event.stageId, event.event, event.waitingReason]), [
    ['api-contract', 'entered', undefined],
    ['api-contract', 'first_action', undefined],
    ['api-contract', 'waiting', 'missing_context'],
    ['api-wiring', 'blocked', 'dependency_waiting']
  ]);
});

test('WorkflowExecutor blocks downstream stages with an error blocker after failure', async () => {
  const eventStore = new InMemoryStageEventStore();
  let downstreamRan = false;
  const result = await new WorkflowExecutor([
    {
      id: 'canonical-read',
      kind: 'evidence',
      owner: 'xigua-frontend-agent',
      run: async () => {
        throw new Error('canonical source unavailable');
      }
    },
    {
      id: 'page-write',
      kind: 'coding',
      owner: 'xigua-frontend-agent',
      dependsOn: ['canonical-read'],
      run: async () => {
        downstreamRan = true;
        return { status: 'passed' };
      }
    }
  ], {
    loopId: 'frontend-delivery',
    runId: 'run-failed',
    taskId: 'task-failed',
    maxParallelTasks: 1,
    eventStore
  }).execute();

  assert.equal(downstreamRan, false);
  assert.deepEqual(result.stages.map((stage) => [stage.id, stage.status, stage.waitingReason]), [
    ['canonical-read', 'failed', 'error_blocker'],
    ['page-write', 'blocked', 'error_blocker']
  ]);
  assert.deepEqual(eventStore.events.map((event) => [event.stageId, event.event, event.waitingReason]), [
    ['canonical-read', 'entered', undefined],
    ['canonical-read', 'first_action', undefined],
    ['canonical-read', 'failed', 'error_blocker'],
    ['page-write', 'blocked', 'error_blocker']
  ]);
});

test('WorkflowExecutor appends lifecycle events in order to the JSONL stage event store', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'workflow-stage-events-'));
  const stageEventsFile = path.join(root, 'stage-events.jsonl');
  let tick = 0;

  try {
    const result = await new WorkflowExecutor([
      {
        id: 'intake',
        kind: 'intake',
        owner: 'xigua-frontend-agent',
        run: async () => ({ status: 'passed', evidence: ['normalized requirement source'] })
      }
    ], {
      loopId: 'frontend-delivery',
      runId: 'run-jsonl',
      taskId: 'task-jsonl',
      maxParallelTasks: 1,
      eventStore: new JsonlStageEventStore(stageEventsFile),
      now: () => new Date(Date.UTC(2026, 8, 15, 0, 0, 0, tick++))
    }).execute();

    const persisted = (await readFile(stageEventsFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { event: string; evidence?: string[] });

    assert.deepEqual(result.events.map((event) => event.event), ['entered', 'first_action', 'completed']);
    assert.deepEqual(persisted.map((event) => event.event), ['entered', 'first_action', 'completed']);
    assert.deepEqual(persisted.at(-1)?.evidence, ['normalized requirement source']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
