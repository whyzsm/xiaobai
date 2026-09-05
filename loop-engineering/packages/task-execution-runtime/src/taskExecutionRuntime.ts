import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { resolveMemoryRoot } from '../../shared/src/memoryRoot';
import {
  RequirementArtifact,
  RequirementIntakeInput,
  RuntimePlan,
  TaskExecutionAdapter,
  TaskExecutionResult,
  TaskStageEvent,
  XiaonengRequirementPolicy
} from '../../shared/src/types';
import { LoopRuntime, RuntimeOptions } from '../../loop-runtime/src/loopRuntime';

const POLICY_PATH = 'harness/contracts/runtime/tmax-requirement-policy.json';
const TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export interface TaskExecutionOptions extends RuntimeOptions {
  requirement: RequirementIntakeInput;
  adapter?: TaskExecutionAdapter;
  persistArtifacts?: boolean;
}

export class TaskExecutionRuntime {
  constructor(private readonly loopRuntime = new LoopRuntime()) {}

  async execute(options: TaskExecutionOptions): Promise<TaskExecutionResult> {
    const plan = await this.loopRuntime.dryRun(options);
    const xiaoneng = plan.xiaoneng;
    if (!xiaoneng || plan.orchestrator?.routesTo.project.projectId !== 't-max') {
      throw new Error('TMAX_REQUIREMENT_POLICY_UNAVAILABLE: task execution requires a resolved T-MAX Xiaoneng context');
    }

    const taskId = xiaoneng.taskContextLock.taskId;
    assertTaskId(taskId);
    const startedAt = options.now ?? new Date();
    const policy = await loadRequirementPolicy(xiaoneng.sourceConsumption.sourceRoot);
    const requirementArtifact = buildRequirementArtifact({
      plan,
      taskId,
      input: options.requirement,
      policy: policy.value,
      policyPath: policy.relativePath,
      policyDigest: policy.digest
    });
    const requirementFinishedAt = new Date();
    const stageEvents: TaskStageEvent[] = [
      stageEvent({
        taskId,
        stageId: 'target-repository-resolution',
        startedAt,
        finishedAt: startedAt,
        status: 'completed',
        evidence: [
          `targetRepository:${xiaoneng.taskContextLock.targetRepository}`,
          `contextDigest:${xiaoneng.skillContext.contextDigest}`,
          `manifestDigest:${xiaoneng.skillContext.manifestDigest}`
        ]
      }),
      stageEvent({
        taskId,
        stageId: 'requirement-intake',
        startedAt,
        finishedAt: requirementFinishedAt,
        status: requirementArtifact.status === 'go' ? 'completed' : 'blocked',
        evidence: [
          `policy:${policy.relativePath}@${policy.digest}`,
          ...requirementArtifact.requirementSources.map((source) =>
            `requirement:${source.pageRoute}:${source.requestedVersion}:${source.contentHash}`
          ),
          ...requirementArtifact.blockingReasons.map((reason) => `blocker:${reason}`)
        ]
      })
    ];

    let artifactDirectory: string | undefined;
    if (options.persistArtifacts) {
      artifactDirectory = await persistTaskArtifacts(options.workspaceRoot, plan, requirementArtifact, stageEvents);
    }

    if (requirementArtifact.status === 'blocked') {
      return { plan, requirementArtifact, stageEvents, status: 'blocked', artifactDirectory };
    }

    if (!options.adapter) {
      stageEvents.push(stageEvent({
        taskId,
        stageId: 'external-dispatch',
        startedAt: requirementFinishedAt,
        finishedAt: requirementFinishedAt,
        status: 'waiting',
        waitingReason: 'EXTERNAL_EXECUTION_ADAPTER_REQUIRED',
        evidence: ['dispatch:not-started']
      }));
      if (artifactDirectory) {
        await appendStageEvents(artifactDirectory, stageEvents.slice(-1));
      }
      return { plan, requirementArtifact, stageEvents, status: 'ready_for_adapter', artifactDirectory };
    }

    const dispatchStartedAt = new Date();
    const dispatched = await options.adapter.dispatch({
      plan,
      requirementArtifact,
      targetWriteRoot: xiaoneng.taskContextLock.targetMount
    });
    const dispatchFinishedAt = new Date();
    stageEvents.push(stageEvent({
      taskId,
      stageId: 'external-dispatch',
      startedAt: dispatchStartedAt,
      finishedAt: dispatchFinishedAt,
      status: dispatched.status === 'completed' ? 'completed' : 'blocked',
      waitingReason: dispatched.waitingReason,
      evidence: dispatched.evidence
    }));
    if (artifactDirectory) {
      await appendStageEvents(artifactDirectory, stageEvents.slice(-1));
    }

    return {
      plan,
      requirementArtifact,
      stageEvents,
      status: dispatched.status === 'completed' ? 'completed' : 'blocked',
      artifactDirectory,
      adapter: { id: options.adapter.id, status: dispatched.status, evidence: dispatched.evidence }
    };
  }
}

export function buildRequirementArtifact(input: {
  plan: RuntimePlan;
  taskId: string;
  policy: XiaonengRequirementPolicy;
  policyPath: string;
  policyDigest: string;
  input: RequirementIntakeInput;
}): RequirementArtifact {
  const xiaoneng = input.plan.xiaoneng;
  if (!xiaoneng) {
    throw new Error('TMAX_REQUIREMENT_POLICY_UNAVAILABLE: Xiaoneng context is required');
  }

  assertRequirementIntakeShape(input.input);
  const reasons = validateRequirementInput(input.input, input.policy);
  const artifactBase = {
    contractVersion: '1.0.0' as const,
    taskId: input.taskId,
    projectId: xiaoneng.taskContextLock.projectId,
    targetRepository: xiaoneng.taskContextLock.targetRepository,
    scope: input.input.scope,
    targetPageRoutes: input.input.targetPageRoutes,
    background: {
      id: 'xiaoneng' as const,
      commit: xiaoneng.skillContext.skillCommit,
      manifestDigest: xiaoneng.skillContext.manifestDigest,
      contextDigest: xiaoneng.skillContext.contextDigest
    },
    policy: {
      path: input.policyPath,
      digest: input.policyDigest,
      version: input.policy.version
    },
    backendContract: input.input.backendContract,
    requirementSources: input.input.requirementSources.map((source) => ({
      pageRoute: source.pageRoute,
      sourceUri: source.sourceUri,
      requestedVersion: source.requestedVersion,
      sectionHeading: source.extractedSection.heading,
      contentHash: sha256(source.extractedSection.content),
      visualEvidenceStatus: source.visualEvidenceStatus
    })),
    requirements: input.input.requirements,
    acceptanceCriteria: input.input.acceptanceCriteria,
    openQuestions: input.input.openQuestions ?? [],
    precision: input.input.precision,
    status: reasons.length === 0 ? 'go' as const : 'blocked' as const,
    blockingReasons: reasons
  };

  return {
    ...artifactBase,
    contentDigest: sha256(stableJson(artifactBase))
  };
}

function validateRequirementInput(input: RequirementIntakeInput, policy: XiaonengRequirementPolicy): string[] {
  const reasons: string[] = [];
  const targetRoutes = new Set(input.targetPageRoutes);
  if (targetRoutes.size !== input.targetPageRoutes.length || targetRoutes.size === 0 || targetRoutes.has('')) {
    reasons.push('REQUIREMENT_TARGET_PAGE_ROUTE_INVALID');
  }
  if (input.requirementSources.length === 0) {
    reasons.push('REQUIREMENT_SOURCE_MISSING');
  }
  const sourceRoutes = new Set<string>();
  for (const source of input.requirementSources) {
    sourceRoutes.add(source.pageRoute);
    if (!source.pageRoute.trim()) reasons.push('REQUIREMENT_PAGE_ROUTE_MISSING');
    if (!source.sourceUri.trim()) reasons.push('REQUIREMENT_SOURCE_URI_MISSING');
    if (!source.requestedVersion.trim()) reasons.push('REQUIREMENT_VERSION_MISSING');
    if (source.extractedSection.heading !== source.requestedVersion) {
      reasons.push(`REQUIREMENT_VERSION_HEADING_MISMATCH:${source.pageRoute}`);
    }
    if (!source.extractedSection.content.trim()) {
      reasons.push(`REQUIREMENT_SECTION_EMPTY:${source.pageRoute}`);
    }
    if (source.visualEvidenceStatus === 'required_missing') {
      reasons.push(`REQUIREMENT_VISUAL_EVIDENCE_MISSING:${source.pageRoute}`);
    }
  }
  for (const route of targetRoutes) {
    if (!sourceRoutes.has(route)) reasons.push(`REQUIREMENT_TARGET_PAGE_SOURCE_MISSING:${route}`);
  }

  const acceptanceIds = new Set(input.acceptanceCriteria.map((criterion) => criterion.id));
  if (acceptanceIds.size !== input.acceptanceCriteria.length || acceptanceIds.has('')) {
    reasons.push('REQUIREMENT_ACCEPTANCE_ID_INVALID');
  }
  const requirementIds = new Set<string>();
  for (const requirement of input.requirements) {
    if (!requirement.id || requirementIds.has(requirement.id)) {
      reasons.push('REQUIREMENT_ITEM_ID_INVALID');
    }
    requirementIds.add(requirement.id);
    if (!requirement.text.trim()) reasons.push(`REQUIREMENT_ITEM_TEXT_MISSING:${requirement.id}`);
    if (requirement.acceptanceIds.length === 0 || requirement.acceptanceIds.some((id) => !acceptanceIds.has(id))) {
      reasons.push(`REQUIREMENT_ACCEPTANCE_LINK_MISSING:${requirement.id}`);
    }
  }
  if (input.requirements.length === 0) reasons.push('REQUIREMENT_ITEM_MISSING');

  if (input.scope === 'frontend_only' && input.backendContract.status === 'not_provided') {
    if (input.backendContract.allowNewRequest !== policy.backendContract.frontendOnlyWithoutBackend.allowNewRequest) {
      reasons.push('BACKEND_CONTRACT_NEW_REQUEST_FORBIDDEN');
    }
    if (
      input.backendContract.allowResponseFieldGuessing !==
      policy.backendContract.frontendOnlyWithoutBackend.allowResponseFieldGuessing
    ) {
      reasons.push('BACKEND_CONTRACT_RESPONSE_FIELD_GUESSING_FORBIDDEN');
    }
  }

  if (input.precision) {
    const values = [input.precision.display, input.precision.input, input.precision.import];
    if (values.some((value) => !value.trim())) {
      reasons.push('REQUIREMENT_PRECISION_LAYER_MISSING');
    }
  }
  for (const question of input.openQuestions ?? []) {
    if (!question.id || !question.text.trim()) reasons.push('REQUIREMENT_OPEN_QUESTION_INVALID');
    if (question.blocksImplementation) reasons.push(`REQUIREMENT_OPEN_QUESTION_BLOCKING:${question.id}`);
  }

  return [...new Set(reasons)].sort();
}

function assertRequirementIntakeShape(input: RequirementIntakeInput): void {
  if (!isRecord(input) ||
    (input.scope !== 'frontend_only' && input.scope !== 'full_stack') ||
    !isRecord(input.backendContract) ||
    !Array.isArray(input.targetPageRoutes) ||
    !Array.isArray(input.requirementSources) ||
    !Array.isArray(input.requirements) ||
    !Array.isArray(input.acceptanceCriteria) ||
    (input.openQuestions !== undefined && !Array.isArray(input.openQuestions)) ||
    (input.precision !== undefined && !isRecord(input.precision))) {
    throw new Error('REQUIREMENT_ARTIFACT_INPUT_INVALID');
  }

  for (const source of input.requirementSources) {
    if (!isRecord(source) || !isRecord(source.extractedSection)) {
      throw new Error('REQUIREMENT_ARTIFACT_INPUT_INVALID');
    }
  }
  for (const requirement of input.requirements) {
    if (!isRecord(requirement) || !Array.isArray(requirement.acceptanceIds)) {
      throw new Error('REQUIREMENT_ARTIFACT_INPUT_INVALID');
    }
  }
  if ((input.openQuestions ?? []).some((question) => !isRecord(question))) {
    throw new Error('REQUIREMENT_ARTIFACT_INPUT_INVALID');
  }
}

async function loadRequirementPolicy(sourceRoot: string): Promise<{
  value: XiaonengRequirementPolicy;
  relativePath: string;
  digest: string;
}> {
  const policyPath = path.join(sourceRoot, POLICY_PATH);
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(policyPath, 'utf8'));
  } catch {
    throw new Error(`TMAX_REQUIREMENT_POLICY_UNAVAILABLE: cannot read ${POLICY_PATH}`);
  }
  if (!isRequirementPolicy(raw)) {
    throw new Error(`TMAX_REQUIREMENT_POLICY_INVALID: ${POLICY_PATH}`);
  }
  return { value: raw, relativePath: POLICY_PATH, digest: sha256(stableJson(raw)) };
}

function isRequirementPolicy(value: unknown): value is XiaonengRequirementPolicy {
  if (!isRecord(value)) return false;
  const sourceBinding = value.sourceBinding;
  const backendContract = value.backendContract;
  const precision = value.precision;
  const referenceSelection = value.referenceSelection;
  return value.kind === 'TmaxRequirementPolicy' &&
    value.version === '1.0.0' &&
    value.appliesTo === 't-max' &&
    isRecord(sourceBinding) &&
    sourceBinding.requirePageRoute === true &&
    sourceBinding.requireSourceUri === true &&
    sourceBinding.requireRequestedVersion === true &&
    sourceBinding.requireExactSectionHeading === true &&
    sourceBinding.requireContentHash === true &&
    isRecord(backendContract) &&
    isRecord(backendContract.frontendOnlyWithoutBackend) &&
    backendContract.frontendOnlyWithoutBackend.allowNewRequest === false &&
    backendContract.frontendOnlyWithoutBackend.allowResponseFieldGuessing === false &&
    isRecord(precision) &&
    precision.requireSeparatedLayersWhenSpecified === true &&
    Array.isArray(precision.requiredLayers) &&
    precision.requiredLayers.join(',') === 'display,input,import' &&
    isRecord(referenceSelection) &&
    referenceSelection.canonicalTemplateSource === 'xiaoneng' &&
    referenceSelection.targetProjectRole === 'project_facts_only';
}

async function persistTaskArtifacts(
  workspaceRoot: string,
  plan: RuntimePlan,
  requirementArtifact: RequirementArtifact,
  stageEvents: TaskStageEvent[]
): Promise<string> {
  const memoryRoot = await resolveMemoryRoot(workspaceRoot);
  const artifactDirectory = path.join(memoryRoot, 'loops', plan.loopId, 'tasks', requirementArtifact.taskId);
  await mkdir(artifactDirectory, { recursive: true });
  await writeJsonAtomic(path.join(artifactDirectory, 'requirement.json'), requirementArtifact);
  await writeJsonAtomic(
    path.join(artifactDirectory, 'task-context.json'),
    {
      taskContextLock: plan.xiaoneng?.taskContextLock,
      sourceConsumption: plan.xiaoneng?.sourceConsumption,
      generatedAt: new Date().toISOString()
    }
  );
  await appendStageEvents(artifactDirectory, stageEvents);
  return artifactDirectory;
}

async function appendStageEvents(artifactDirectory: string, events: TaskStageEvent[]): Promise<void> {
  if (events.length === 0) return;
  await appendFile(
    path.join(artifactDirectory, 'stage-events.jsonl'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    'utf8'
  );
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, filePath);
}

function stageEvent(input: {
  taskId: string;
  stageId: TaskStageEvent['stageId'];
  startedAt: Date;
  finishedAt: Date;
  status: TaskStageEvent['status'];
  waitingReason?: string;
  evidence: string[];
}): TaskStageEvent {
  const durationMs = Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime());
  return {
    taskId: input.taskId,
    stageId: input.stageId,
    enteredAt: input.startedAt.toISOString(),
    firstActionAt: input.startedAt.toISOString(),
    exitedAt: input.finishedAt.toISOString(),
    durationMs,
    activeMs: input.status === 'waiting' ? 0 : durationMs,
    waitingMs: input.status === 'waiting' ? durationMs : 0,
    waitingReason: input.waitingReason,
    status: input.status,
    evidence: input.evidence
  };
}

function assertTaskId(taskId: string): void {
  if (!TASK_ID_PATTERN.test(taskId)) {
    throw new Error(`TASK_ID_INVALID: ${taskId}`);
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
