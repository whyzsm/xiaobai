import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import { standardPageArtifactRoot } from '../../shared/src/taskArtifacts';
import { GateCheckService } from '../../human-gate/src/gateCheck';
import {
  GatePassEvidence,
  JsonRecord,
  LoopSpec,
  RepositoryAction,
  RuntimePlan,
  TaskEnvelope,
  TaskEvent,
  TaskEventType,
  TaskRequest,
  TaskState,
  BackgroundContextLock
} from '../../shared/src/types';
import {
  assertValidTaskEnvelope,
  validateTaskRequest
} from '../../shared/src/portableExecutionContracts';
import { SkillContextResolver } from '../../skill-context-runtime/src/skillContextResolver';

export interface TaskRuntimeOptions {
  workspaceRoot: string;
  memoryRoot: string;
  loop: LoopSpec;
  plan?: RuntimePlan;
  now?: () => Date;
}

export interface TaskCreateInput {
  request: TaskRequest;
  taskId?: string;
}

export interface TaskTransitionInput {
  taskId: string;
  eventType: TaskEventType;
  state: TaskState;
  actor?: TaskEvent['actor'];
  data?: JsonRecord;
  evidence?: GatePassEvidence[];
}

const eventToState: Partial<Record<TaskEventType, TaskState>> = {
  'task/created': 'created',
  'task/prepared': 'prepared',
  'task/leased': 'leased',
  'task/running': 'running',
  'task/submitted': 'submitted',
  'task/verifying': 'verifying',
  'task/ready_to_merge': 'ready_to_merge',
  'task/merged': 'merged',
  'task/blocked': 'blocked',
  'task/failed': 'failed'
};

const allowedTransitions: Record<TaskState, TaskState[]> = {
  created: ['prepared', 'blocked', 'failed'],
  prepared: ['leased', 'running', 'submitted', 'blocked', 'failed'],
  leased: ['running', 'blocked', 'failed'],
  running: ['submitted', 'blocked', 'failed'],
  submitted: ['verifying', 'blocked', 'failed'],
  verifying: ['ready_to_merge', 'blocked', 'failed'],
  ready_to_merge: ['merged', 'blocked', 'failed'],
  merged: [],
  blocked: [],
  failed: []
};

export class TaskRuntime {
  private readonly clock: () => Date;

  constructor(private readonly options: TaskRuntimeOptions) {
    this.clock = options.now ?? (() => new Date());
  }

  filePath(): string {
    return resolveMemoryPath(
      this.options.memoryRoot,
      `memory/tasks/${encodeURIComponent(this.options.loop.metadata.id)}/task-events.jsonl`
    );
  }

  async create(input: TaskCreateInput): Promise<TaskEnvelope> {
    const requestErrors = validateTaskRequest(input.request);
    if (requestErrors.length > 0) throw new Error(`Invalid TaskRequest: ${requestErrors.join('; ')}`);
    if (!this.options.plan) throw new Error('TaskRuntime create requires a RuntimePlan');
    if (input.request.loopId && input.request.loopId !== this.options.loop.metadata.id) {
      throw new Error(`TaskRequest loopId does not match runtime loop ${this.options.loop.metadata.id}`);
    }

    const taskId = input.taskId ?? randomUUID();
    if (await this.find(taskId)) throw new Error(`Task already exists: ${taskId}`);
    const backgroundContextLock = await this.lockBackgroundContext(taskId);
    const now = this.clock().toISOString();
    await this.appendEvent({
      kind: 'TaskEvent',
      version: 1,
      id: randomUUID(),
      seq: 1,
      taskId,
      eventType: 'task/created',
      occurredAt: now,
      actor: 'entrypoint',
      state: 'created',
      data: {
        request: input.request,
        loopId: this.options.loop.metadata.id
      },
      evidence: []
    });
    await this.appendEvent({
      kind: 'TaskEvent',
      version: 1,
      id: randomUUID(),
      seq: 2,
      taskId,
      eventType: 'task/prepared',
      occurredAt: this.clock().toISOString(),
      actor: 'runtime',
      state: 'prepared',
      data: {
        projectRoute: this.options.plan.orchestrator?.routesTo.project,
        backgroundContextDigest: this.options.plan.backgroundContext
          ? backgroundPlanDigestInput(this.options.plan.backgroundContext)
          : null,
        backgroundContextLock: backgroundContextLock ?? null,
        gateRequirements: this.options.plan.humanGate.gates.map((gate) => gate.id)
      },
      evidence: []
    });
    return this.require(taskId);
  }

  async list(): Promise<TaskEnvelope[]> {
    const events = await this.readEvents();
    const taskIds = [...new Set(events.map((event) => event.taskId))].sort();
    return taskIds.map((taskId) => projectTaskEnvelope(this.options.loop, events.filter((event) => event.taskId === taskId)));
  }

  async find(taskId: string): Promise<TaskEnvelope | undefined> {
    const events = (await this.readEvents()).filter((event) => event.taskId === taskId);
    return events.length === 0 ? undefined : projectTaskEnvelope(this.options.loop, events);
  }

  async require(taskId: string): Promise<TaskEnvelope> {
    const task = await this.find(taskId);
    if (!task) throw new Error(`Unknown task: ${taskId}`);
    return task;
  }

  async transition(input: TaskTransitionInput): Promise<TaskEnvelope> {
    const current = await this.require(input.taskId);
    const expectedState = eventToState[input.eventType];
    if (!expectedState || expectedState !== input.state) {
      throw new Error(`Task event ${input.eventType} cannot set state ${input.state}`);
    }
    if (!allowedTransitions[current.state].includes(input.state)) {
      throw new Error(`Invalid task transition: ${current.state} -> ${input.state}`);
    }
    await this.appendEvent({
      kind: 'TaskEvent',
      version: 1,
      id: randomUUID(),
      seq: current.events.length + 1,
      taskId: input.taskId,
      eventType: input.eventType,
      occurredAt: this.clock().toISOString(),
      actor: input.actor ?? 'runtime',
      state: input.state,
      data: input.data ?? {},
      evidence: input.evidence ?? []
    });
    return this.require(input.taskId);
  }

  async run(input: { taskId: string; stageId?: string }): Promise<TaskEnvelope> {
    const task = await this.require(input.taskId);
    const actions = protectedGateActions(this.options.loop, task.requestedActions);
    const decision = await GateCheckService.forMemoryRoot(this.options.loop, this.options.memoryRoot).check({
      runId: task.runId ?? task.taskId,
      taskId: task.taskId,
      stageId: input.stageId,
      actions,
      subject: task.subject,
      now: this.clock()
    });
    if (decision.status === 'blocked') {
      throw new Error(`GATE_CHECK_BLOCKED: ${decision.blockingReasons.join('; ')}`);
    }
    return this.transition({
      taskId: task.taskId,
      eventType: 'task/running',
      state: 'running',
      actor: 'runtime',
      data: {
        stageId: input.stageId ?? null,
        gateStatus: decision.status,
        satisfiedGates: decision.satisfiedGates
      },
      evidence: decision.passes.flatMap((pass) => pass.evidence)
    });
  }

  async readEvents(): Promise<TaskEvent[]> {
    const filePath = this.filePath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch {
        throw new Error(`Invalid TaskEvent JSONL at ${filePath}:${index + 1}`);
      }
      return value as TaskEvent;
    });
  }

  backgroundContextPath(taskId: string): string {
    return resolveMemoryPath(
      this.options.memoryRoot,
      `memory/tasks/${encodeURIComponent(this.options.loop.metadata.id)}/${encodeURIComponent(taskId)}/background-context.json`
    );
  }

  memoryRoot(): string {
    return this.options.memoryRoot;
  }

  private async lockBackgroundContext(taskId: string): Promise<BackgroundContextLock | undefined> {
    const plan = this.options.plan?.backgroundContext;
    if (!plan) return undefined;
    const mountPath = path.resolve(this.options.workspaceRoot, plan.sourceMount);
    if (!(await pathExists(mountPath))) {
      if (this.options.loop.metadata.id === 'ane-standard-page') {
        throw new Error(`XIAONENG_CONTEXT_REQUIRED: background mount is unavailable: ${mountPath}`);
      }
      return undefined;
    }

    const resolved = await new SkillContextResolver(this.options.workspaceRoot).resolve(plan);
    const lock: BackgroundContextLock = {
      kind: 'BackgroundContextLock',
      version: 1,
      taskId,
      projectId: plan.projectId,
      backgroundId: plan.backgroundId,
      skillCommit: resolved.skillContext.skillCommit,
      contextDigest: resolved.skillContext.contextDigest,
      selectedEvidenceBundles: [...(plan.evidenceBundles ?? [])],
      lockedAt: this.clock().toISOString()
    };
    const filePath = this.backgroundContextPath(taskId);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
    const runtimePlan = this.options.plan;
    if (!runtimePlan) return lock;
    const artifactRoot = standardPageArtifactRoot(this.options.workspaceRoot, runtimePlan, taskId);
    if (artifactRoot) {
      await mkdir(artifactRoot, { recursive: true });
      await writeFile(path.join(artifactRoot, 'background-context.json'), `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
      await writeFile(
        path.join(artifactRoot, 'evidence-selection.json'),
        `${JSON.stringify({
          kind: 'XiaonengEvidenceSelection',
          version: 1,
          taskId,
          projectId: plan.projectId,
          backgroundId: plan.backgroundId,
          contextDigest: resolved.skillContext.contextDigest,
          skillCommit: resolved.skillContext.skillCommit,
          bundles: plan.evidenceBundles ?? [],
          sources: resolved.skillContext.sourceFiles ?? []
        }, null, 2)}\n`,
        'utf8'
      );
    }
    return lock;
  }

  private async appendEvent(event: TaskEvent): Promise<void> {
    const existing = (await this.readEvents()).filter((item) => item.taskId === event.taskId);
    if (existing.some((item) => item.id === event.id)) {
      throw new Error(`Cannot append duplicate TaskEvent id: ${event.id}`);
    }
    if (event.seq !== existing.length + 1) {
      throw new Error(`TaskEvent seq must be ${existing.length + 1}, received ${event.seq}`);
    }
    const projected = projectTaskEnvelope(this.options.loop, [...existing, event]);
    assertValidTaskEnvelope(projected);
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }
}

function protectedGateActions(loop: LoopSpec, actions: TaskEnvelope['requestedActions']): string[] {
  const protectedActions = new Set(loop.humanGate.gates.map((gate) => gate.requiredBefore));
  return actions.filter((action) => protectedActions.has(action));
}

function projectTaskEnvelope(loop: LoopSpec, events: TaskEvent[]): TaskEnvelope {
  if (events.length === 0) throw new Error('Cannot project task without events');
  const ordered = [...events].sort((left, right) => left.seq - right.seq);
  const created = ordered[0];
  const request = readCreatedRequest(created);
  const preparedData = ordered.find((event) => event.eventType === 'task/prepared')?.data ?? {};
  const latest = ordered.at(-1);
  if (!latest?.state) throw new Error(`Task ${created.taskId} has no latest state`);
  const leaseEvent = findLastEvent(ordered, (event) => event.eventType === 'task/leased');

  const envelope: TaskEnvelope = {
    kind: 'TaskEnvelope',
    version: 1,
    taskId: created.taskId,
    state: latest.state,
    entryPoint: request.entryPoint,
    projectId: request.projectId,
    repositoryId: request.repositoryId,
    loopId: loop.metadata.id,
    runId: request.runId,
    projectRoute: isRecord(preparedData.projectRoute) ? preparedData.projectRoute as unknown as TaskEnvelope['projectRoute'] : undefined,
    subject: request.subject,
    requestedActions: request.requestedActions,
    providerMode: request.provider?.mode ?? 'client',
    providerProfileId: request.provider?.profileId,
    workspaceLeaseId: stringValue(leaseEvent?.data.workspaceLeaseId),
    gateRequirements: stringArray(preparedData.gateRequirements),
    promptDigest: stringValue(findLastEvent(ordered, (event) => isNonEmptyString(event.data.promptDigest))?.data.promptDigest),
    events: ordered,
    createdAt: created.occurredAt,
    updatedAt: latest.occurredAt
  };
  assertValidTaskEnvelope(envelope);
  return envelope;
}

function readCreatedRequest(event: TaskEvent): TaskRequest {
  if (event.eventType !== 'task/created' || !isRecord(event.data.request)) {
    throw new Error(`Task ${event.taskId} is missing its creation request`);
  }
  const request = event.data.request as unknown as TaskRequest;
  const errors = validateTaskRequest(request);
  if (errors.length > 0) throw new Error(`Invalid stored TaskRequest for ${event.taskId}: ${errors.join('; ')}`);
  return request;
}

function backgroundPlanDigestInput(plan: RuntimePlan['backgroundContext']): JsonRecord {
  if (!plan) return {};
  return {
    kind: plan.kind,
    contractVersion: plan.contractVersion,
    projectId: plan.projectId,
    backgroundId: plan.backgroundId,
    sourceMount: plan.sourceMount,
    manifestPath: plan.manifestPath,
    contractPath: plan.contractPath,
    executionMode: plan.executionMode ?? null,
    evidenceBundles: plan.evidenceBundles ?? [],
    validators: plan.validators ?? [],
    maxCharacters: plan.maxCharacters
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

function stringValue(value: unknown): string | undefined {
  return isNonEmptyString(value) ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function findLastEvent(events: TaskEvent[], predicate: (event: TaskEvent) => boolean): TaskEvent | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (predicate(event)) return event;
  }
  return undefined;
}

export function parseRepositoryAction(value: string): RepositoryAction {
  const actions: RepositoryAction[] = [
    'read',
    'write',
    'push',
    'pull_request',
    'merge',
    'protected_branch_update',
    'delete_branch',
    'delete_worktree',
    'destructive_cleanup'
  ];
  if (!actions.includes(value as RepositoryAction)) throw new Error(`Unsupported repository action: ${value}`);
  return value as RepositoryAction;
}
