import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AnySchema } from 'ajv';
import Ajv2020 from 'ajv/dist/2020';
import YAML from 'yaml';
import { EvaluatorRuntime } from '../../evaluator-runtime/src/evaluatorRuntime';
import { HarnessRuntime, specializeHarnessForStage } from '../../harness-runtime/src/harnessRuntime';
import { GateCheckService } from '../../human-gate/src/gateCheck';
import { GatePassStore } from '../../human-gate/src/humanGate';
import { SkillContextResolver } from '../../skill-context-runtime/src/skillContextResolver';
import {
  BackgroundContextLock,
  ExecutionStageInput,
  ExecutionStageResult,
  ExecutionEvent,
  ExecutorAdapter,
  ExecutorAdapterResult,
  EvaluationVerdict,
  GateCheckInput,
  GateDecision,
  GatePassEvidence,
  HarnessEvidenceType,
  JsonRecord,
  LoopSpec,
  RuntimePlan,
  ResolvedBackgroundContext,
  StageEvent,
  StageEventKey,
  WorkflowStagePlan
} from '../../shared/src/types';
import { pathExists } from '../../shared/src/fs';
import { digestJsonHex, sha256Hex } from '../../shared/src/canonicalDigest';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import { standardPageArtifactRoot, standardPageArtifactsForStage } from '../../shared/src/taskArtifacts';
import { ExecutionEventStore } from './executionEvents';
import { createStageEvent, projectStageTiming, StageEventStore, validateStageEventSequence } from './stageEvents';
import { StageTimingMetricStore, stageTimingSourceKey } from './timingMetrics';
import {
  ContextLockCurrent,
  ContextLockInput,
  ContextPackInput,
  NeutralContractAdapter,
  projectContextEvidence,
  validateContextLock,
  validateContextPack,
  validateContextRequest
} from '../../context-compiler/src/contextCompiler';

export interface ExecutionRuntimeOptions {
  workspaceRoot: string;
  memoryRoot: string;
  loop: LoopSpec;
  plan: RuntimePlan;
  executorInstance?: string;
  now?: () => Date;
  contextContracts?: NeutralContractAdapter;
}

export class GateGuard {
  private readonly service: GateCheckService;

  constructor(loop: LoopSpec, passStore: GatePassStore) {
    this.service = new GateCheckService(loop, passStore);
  }

  async check(input: GateCheckInput): Promise<GateDecision> {
    return this.service.check(input);
  }
}

export class ExecutionRuntime {
  private readonly stageStore: StageEventStore;
  private readonly gateGuard: GateGuard;
  private readonly timingMetricStore: StageTimingMetricStore;
  private readonly executorInstance: string;
  private readonly clock: () => Date;

  constructor(private readonly options: ExecutionRuntimeOptions) {
    if (options.loop.metadata.id !== options.plan.loopId) {
      throw new Error(`Runtime plan loop does not match loop spec: ${options.plan.loopId}`);
    }
    this.stageStore = new StageEventStore(options.memoryRoot, options.loop.metadata.id);
    this.timingMetricStore = new StageTimingMetricStore(options.memoryRoot, options.loop.metadata.id);
    this.gateGuard = new GateGuard(
      options.loop,
      new GatePassStore(options.memoryRoot, options.loop.metadata.id)
    );
    this.executorInstance = options.executorInstance ?? randomUUID();
    this.clock = options.now ?? (() => new Date());
  }

  async execute(input: ExecutionStageInput, adapter: ExecutorAdapter): Promise<ExecutionStageResult> {
    const authority = { scope: 'local_single_executor' as const, executorInstance: this.executorInstance };
    if (!adapter || typeof adapter.id !== 'string' || typeof adapter.execute !== 'function') {
      return blockedResult('', authority, ['executor adapter is invalid']);
    }

    let lock: LocalRunLock;
    try {
      lock = await LocalRunLock.acquire(
        this.options.memoryRoot,
        this.options.loop.metadata.id,
        input.runId,
        this.executorInstance
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return blockedResult(adapter.id, authority, [message]);
    }

    try {
      const result = await this.executeLocked(input, adapter, authority);
      try {
        const timingMetric = await this.timingMetricStore.append(result.stageTiming);
        return { ...result, timingMetric };
      } catch (error) {
        return {
          ...result,
          timingMetric: {
            status: 'failed',
            sourceKey: result.stageTiming ? stageTimingSourceKey(result.stageTiming) : undefined,
            reason: `StageTimingMetric write failed: ${error instanceof Error ? error.message : String(error)}`
          }
        };
      }
    } catch (error) {
      return {
        ...blockedResult(adapter.id, authority, [
          `execution runtime failed closed: ${error instanceof Error ? error.message : String(error)}`
        ]),
        status: 'failed'
      };
    } finally {
      await lock.release();
    }
  }

  private async executeLocked(
    input: ExecutionStageInput,
    adapter: ExecutorAdapter,
    authority: ExecutionStageResult['authority']
  ): Promise<ExecutionStageResult> {
    const stage = this.options.plan.workflow?.stages.find((item) => item.id === input.stageId);
    if (!stage) return blockedResult(adapter.id, authority, [`Unknown workflow stage: ${input.stageId}`]);
    const attempt = input.attempt ?? 1;
    if (!Number.isInteger(attempt) || attempt < 1) {
      return blockedResult(adapter.id, authority, ['attempt must be a positive integer']);
    }

    const owner = stageOwner(stage, this.options.loop);
    const scope: StageEventKey & Pick<StageEvent, 'stageKind' | 'owner'> = {
      loopId: this.options.loop.metadata.id,
      runId: input.runId,
      taskId: input.taskId,
      stageId: stage.id,
      attempt,
      stageKind: stage.kind,
      owner
    };
    const recorded: StageEvent[] = [];
    const executionStore = new ExecutionEventStore(
      this.options.memoryRoot,
      this.options.plan.projectContext.projectId,
      this.options.loop.metadata.id,
      input.runId,
      { now: this.clock }
    );
    const executionEvents: ExecutionEvent[] = [];
    const append = async (
      eventType: Parameters<typeof createStageEvent>[0]['eventType'],
      evidence: GatePassEvidence[] = [],
      waitingReason?: Parameters<typeof createStageEvent>[0]['waitingReason']
    ): Promise<StageEvent> => {
      const event = createStageEvent({
        ...scope,
        eventType,
        occurredAt: this.clock().toISOString(),
        evidence,
        waitingReason
      });
      await this.stageStore.append(event);
      recorded.push(event);
      return event;
    };
    const appendExecution = async (
      event: Omit<Parameters<ExecutionEventStore['append']>[0], keyof StageEventKey | 'projectId'>
    ): Promise<ExecutionEvent> => {
      const recordedEvent = await executionStore.append({
        projectId: this.options.plan.projectContext.projectId,
        loopId: scope.loopId,
        runId: scope.runId,
        taskId: scope.taskId,
        stageId: scope.stageId,
        attempt: scope.attempt,
        ...event
      });
      executionEvents.push(recordedEvent);
      return recordedEvent;
    };

    let existingEvents: StageEvent[];
    try {
      existingEvents = await this.stageStore.readAll();
    } catch (error) {
      return blockedResult(adapter.id, authority, [
        `StageEvent store unavailable: ${error instanceof Error ? error.message : String(error)}`
      ]);
    }
    const dependencyReasons = dependencyFailures(existingEvents, input, stage);
    if (dependencyReasons.length > 0) {
      await append('entered');
      await append('blocked', [otherEvidence(dependencyReasons.join('; '))]);
      return executionResult('blocked', adapter.id, authority, dependencyReasons, null, null, recorded, executionEvents);
    }

    await append('entered');
    const actions = input.actions ?? [];
    const gateDecision = await this.gateGuard.check({
      runId: input.runId,
      taskId: input.taskId,
      stageId: stage.id,
      actions,
      subject: input.subject,
      now: this.clock()
    });
    await appendExecution({
      actor: 'runtime',
      eventType: 'gate/decision',
      data: {
        status: gateDecision.status,
        requiredGates: gateDecision.requiredGates,
        satisfiedGates: gateDecision.satisfiedGates,
        blockingReasons: gateDecision.blockingReasons
      }
    });
    if (gateDecision.status === 'blocked') {
      await append('blocked', [otherEvidence(`GateGuard blocked: ${gateDecision.blockingReasons.join('; ')}`)]);
      return executionResult(
        'blocked',
        adapter.id,
        authority,
        gateDecision.blockingReasons,
        gateDecision,
        null,
        recorded,
        executionEvents
      );
    }

    if (stage.gate !== 'automatic') {
      const reasons = ['manual workflow stage requires human completion'];
      await append('blocked', [otherEvidence(reasons[0])]);
      return executionResult('blocked', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    if (!stage.harness) {
      const reasons = ['automatic workflow stage has no configured harness'];
      await append('blocked', [otherEvidence(reasons[0])]);
      return executionResult('blocked', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }

    await append('first_action');
    let backgroundContext: ResolvedBackgroundContext | undefined;
    let contextPack: ContextPackInput | undefined;
    let contextEvidence: JsonRecord | undefined;
    if (input.context && this.options.plan.backgroundContext) {
      const reasons = ['CONTEXT_MODE_CONFLICT: context-pack and legacy background cannot be injected together'];
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    if (this.options.loop.metadata.id === 'ane-standard-page' && !this.options.plan.backgroundContext && !input.context) {
      const reasons = ['XIAONENG_CONTEXT_REQUIRED: StandardPage execution has no background context plan'];
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    if (input.context) {
      try {
        const contracts = this.options.contextContracts;
        if (!contracts) throw new Error('CONTEXT_CONTRACT_ADAPTER_REQUIRED: neutral contract adapter is unavailable');
        if (input.context.mode !== 'context-pack') throw new Error('CONTEXT_MODE_UNSUPPORTED: execution context mode is not supported');
        validateContextRequest(input.context.request, contracts);
        validateContextPack(input.context.pack, contracts);
        contextPack = input.context.pack as unknown as ContextPackInput;
        const current = contextLockCurrent(input.context.current, input.taskId);
        if (current.stage !== 'execute') throw new Error('CONTEXT_STAGE_MISMATCH: writable execution requires an execute lock');
        if (current.projectId !== this.options.plan.projectContext.projectId) {
          throw new Error('CONTEXT_PROJECT_MISMATCH: context does not belong to the runtime project');
        }
        const expectedRepositoryId = this.options.plan.projectRoute.resolution.matchedRepositoryId;
        if (expectedRepositoryId && current.repositoryId !== expectedRepositoryId) {
          throw new Error('CONTEXT_REPOSITORY_MISMATCH: context does not belong to the resolved repository');
        }
        if (
          contextPack.projectId !== current.projectId ||
          contextPack.repositoryId !== current.repositoryId ||
          contextPack.repositoryCommit !== current.repositoryCommit ||
          contextPack.contextDigest !== current.contextPackDigest
        ) {
          throw new Error('CONTEXT_PACK_BINDING_MISMATCH: ContextPack does not match the current repository/context tuple');
        }
        const request = input.context.request;
        const requestProject = isRecord(request.project) ? request.project : undefined;
        const requestRepository = isRecord(request.repository) ? request.repository : undefined;
        if (
          request.requestId !== contextPack.requestId ||
          requestProject?.projectId !== current.projectId ||
          requestRepository?.repositoryId !== current.repositoryId ||
          requestRepository?.commit !== current.repositoryCommit ||
          requestRepository?.branch !== current.branch ||
          requestProject?.projectId !== contextPack.projectId ||
          requestRepository?.repositoryId !== contextPack.repositoryId
        ) {
          throw new Error('CONTEXT_REQUEST_BINDING_MISMATCH: ContextRequest does not match the locked repository tuple');
        }
        if (current.policyDigest !== this.options.plan.projectContext.policyDigest) {
          throw new Error('CONTEXT_POLICY_DRIFT: current policy digest differs from the runtime policy');
        }
        validateContextLock(input.context.lock as ContextLockInput | null | undefined, current, contracts);
        const evidence = projectContextEvidence(
          input.context.request,
          contextPack,
          input.context.lock as unknown as ContextLockInput,
          'context-pack',
          contracts
        );
        contextEvidence = evidence as unknown as JsonRecord;
      } catch (error) {
        const reasons = [
          `ContextPack loading failed closed: ${error instanceof Error ? error.message : String(error)}`
        ];
        await append('failed', [otherEvidence(reasons[0])]);
        return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
      }
      await appendExecution({
        actor: 'runtime',
        eventType: 'context/resolved',
        data: {
          mode: 'context-pack',
          contextPackId: contextPack.contextPackId,
          requestId: contextPack.requestId,
          projectId: contextPack.projectId,
          repositoryId: contextPack.repositoryId,
          repositoryCommit: contextPack.repositoryCommit,
          contextDigest: contextPack.contextDigest,
          evidence: contextEvidence
        }
      });
    }
    if (this.options.plan.backgroundContext) {
      try {
        backgroundContext = await new SkillContextResolver(this.options.workspaceRoot).resolve(
          this.options.plan.backgroundContext
        );
        const lock = await readBackgroundContextLock(
          this.options.workspaceRoot,
          this.options.plan,
          this.options.memoryRoot,
          this.options.loop.metadata.id,
          scope.taskId
        );
        if (this.options.loop.metadata.id === 'ane-standard-page' && !lock) {
          throw new Error('XIAONENG_CONTEXT_LOCK_REQUIRED: StandardPage task context lock is missing');
        }
        if (
          lock &&
          (lock.projectId !== this.options.plan.backgroundContext.projectId ||
            lock.backgroundId !== this.options.plan.backgroundContext.backgroundId ||
            lock.skillCommit !== backgroundContext.skillContext.skillCommit ||
            JSON.stringify(lock.selectedEvidenceBundles) !==
              JSON.stringify(this.options.plan.backgroundContext.evidenceBundles ?? []))
        ) {
          throw new Error('XIAONENG_CONTEXT_LOCK_MISMATCH: lock identity or selected evidence differs from the plan');
        }
        if (lock && lock.contextDigest !== backgroundContext.skillContext.contextDigest) {
          throw new Error(
            `XIAONENG_CONTEXT_DIGEST_MISMATCH: locked ${lock.contextDigest}, resolved ${backgroundContext.skillContext.contextDigest}`
          );
        }
      } catch (error) {
        const reasons = [
          `Background context loading failed closed: ${error instanceof Error ? error.message : String(error)}`
        ];
        await append('failed', [otherEvidence(reasons[0])]);
        return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
      }
      await appendExecution({
        actor: 'runtime',
        eventType: 'context/resolved',
        data: backgroundContextEventData(backgroundContext)
      });
    }
    let standardPageArtifacts: JsonRecord | undefined;
    try {
      standardPageArtifacts = await readStandardPageArtifacts(
        this.options.workspaceRoot,
        this.options.plan,
        scope.taskId,
        stage.id,
        backgroundContext
      );
    } catch (error) {
      const reasons = [`Task artifact loading failed closed: ${error instanceof Error ? error.message : String(error)}`];
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    const executorSubject = standardPageArtifacts
      ? { ...input.subject, xiaobaiStandardPageArtifacts: standardPageArtifacts }
      : input.subject;
    if (standardPageArtifacts) {
      await appendExecution({
        actor: 'runtime',
        eventType: 'context/resolved',
        data: { standardPageArtifacts: standardPageArtifacts.summary as JsonRecord },
        evidence: standardPageArtifacts.evidence as GatePassEvidence[]
      });
    }
    let adapterResult;
    await append('waiting_started', [], 'tool_running');
    try {
      adapterResult = await adapter.execute({
        loopId: scope.loopId,
        runId: scope.runId,
        taskId: scope.taskId,
        stage,
        attempt,
        actions,
        subject: executorSubject,
        workspaceRoot: this.options.workspaceRoot,
        worktreePath: input.worktreePath,
        ...(backgroundContext ? { backgroundContext } : {}),
        ...(contextPack ? { contextPack: contextPack as unknown as JsonRecord } : {}),
        ...(contextEvidence ? { contextEvidence } : {}),
        eventReporter: {
          record: async (event) => {
            await appendExecution({ actor: 'executor', ...event });
          }
        }
      });
    } catch (error) {
      await append('waiting_ended', [], 'tool_running');
      const reasons = [`executor adapter failed: ${error instanceof Error ? error.message : String(error)}`];
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    await append('waiting_ended', [], 'tool_running');

    if (!isExecutorAdapterResult(adapterResult)) {
      const reasons = ['executor adapter returned an invalid result'];
      await appendExecution({
        actor: 'runtime',
        eventType: 'executor/completed',
        data: { adapterId: adapter.id, status: 'invalid' }
      });
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    if (standardPageArtifacts) {
      adapterResult = {
        ...adapterResult,
        evidence: [...(standardPageArtifacts.evidence as GatePassEvidence[]), ...adapterResult.evidence]
      };
    }
    await appendExecution({
      actor: 'runtime',
      eventType: 'executor/completed',
      data: {
        adapterId: adapter.id,
        status: adapterResult.status,
        reason: adapterResult.reason ?? null
      },
      evidence: adapterResult.evidence
    });

    if (adapterResult.status === 'blocked' || adapterResult.status === 'failed') {
      const reason = adapterResult.reason ?? `executor adapter returned ${adapterResult.status}`;
      await append(adapterResult.status, adapterResult.evidence.length > 0 ? adapterResult.evidence : [otherEvidence(reason)]);
      return executionResult(
        adapterResult.status,
        adapter.id,
        authority,
        [reason],
        gateDecision,
        null,
        recorded,
        executionEvents
      );
    }

    let harnessResult;
    try {
      const stageLoop = stageLoopSpec(this.options.loop, stage);
      const harnessRuntime = new HarnessRuntime(this.options.workspaceRoot);
      const harness = specializeHarnessForStage(await harnessRuntime.load(stageLoop), stage);
      harnessResult = harnessRuntime.evaluateRun(stageLoop, harness, adapterResult.submission);
    } catch (error) {
      const reasons = [`Harness validation failed closed: ${error instanceof Error ? error.message : String(error)}`];
      await append('failed', [otherEvidence(reasons[0])]);
      return executionResult('failed', adapter.id, authority, reasons, gateDecision, null, recorded, executionEvents);
    }
    for (const verdict of validatorVerdictEventData(harnessResult)) {
      await appendExecution({
        actor: 'harness',
        eventType: 'validator/verdict',
        data: verdict
      });
    }
    await appendExecution({
      actor: 'harness',
      eventType: 'harness/verdict',
      data: harnessVerdictEventData(harnessResult)
    });

    let evaluationVerdict: EvaluationVerdict | null = null;
    if (stage.evaluator) {
      evaluationVerdict = new EvaluatorRuntime().decide({
        loop: this.options.loop,
        stage,
        runId: input.runId,
        taskId: input.taskId,
        harnessResult,
        evidence: adapterResult.evidence
      });
      await appendExecution({
        actor: 'evaluator',
        eventType: 'evaluation/verdict',
        data: {
          evaluatorId: evaluationVerdict.evaluatorId,
          independent: evaluationVerdict.independent,
          decision: evaluationVerdict.decision,
          requiredChecks: evaluationVerdict.requiredChecks,
          reasons: evaluationVerdict.reasons
        },
        evidence: evaluationVerdict.evidence
      });
    }

    if (harnessResult.status !== 'passed' || evaluationVerdict?.decision === 'rejected') {
      const reasons = [
        harnessResult.status !== 'passed'
          ? 'Harness rejected executor submission'
          : 'Independent evaluator rejected executor submission'
      ];
      await append('failed', [
        ...(backgroundContext ? adapterResult.evidence : []),
        otherEvidence(`${reasons[0]}: ${summarizeHarnessViolations(harnessResult)}`)
      ]);
      return executionResult(
        'failed',
        adapter.id,
        authority,
        reasons,
        gateDecision,
        harnessResult,
        recorded,
        executionEvents,
        evaluationVerdict
      );
    }

    await append('passed', adapterResult.evidence);
    return executionResult(
      'passed',
      adapter.id,
      authority,
      [],
      gateDecision,
      harnessResult,
      recorded,
      executionEvents,
      evaluationVerdict
    );
  }
}

async function readBackgroundContextLock(
  workspaceRoot: string,
  plan: RuntimePlan,
  memoryRoot: string,
  loopId: string,
  taskId: string
): Promise<BackgroundContextLock | undefined> {
  const artifactRoot = standardPageArtifactRoot(workspaceRoot, plan, taskId);
  const candidates = [
    ...(artifactRoot ? [path.join(artifactRoot, 'background-context.json')] : []),
    resolveMemoryPath(
      memoryRoot,
      `memory/tasks/${encodeURIComponent(loopId)}/${encodeURIComponent(taskId)}/background-context.json`
    )
  ];
  for (const filePath of candidates) {
    if (!(await pathExists(filePath))) continue;
    try {
      const value = JSON.parse(await readFile(filePath, 'utf8')) as Partial<BackgroundContextLock>;
      if (
        value.kind !== 'BackgroundContextLock' ||
        value.version !== 1 ||
        value.taskId !== taskId ||
        typeof value.projectId !== 'string' ||
        typeof value.backgroundId !== 'string' ||
        typeof value.skillCommit !== 'string' ||
        typeof value.contextDigest !== 'string' ||
        !Array.isArray(value.selectedEvidenceBundles) ||
        typeof value.lockedAt !== 'string'
      ) {
        throw new Error('context lock fields are incomplete or do not match the task');
      }
      return value as BackgroundContextLock;
    } catch (error) {
      throw new Error(`XIAONENG_CONTEXT_LOCK_INVALID: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return undefined;
}

async function readStandardPageArtifacts(
  workspaceRoot: string,
  plan: RuntimePlan,
  taskId: string,
  stageId: string,
  backgroundContext?: ResolvedBackgroundContext
): Promise<JsonRecord | undefined> {
  const required = standardPageArtifactsForStage(stageId);
  if (required.length === 0) return undefined;
  const root = standardPageArtifactRoot(workspaceRoot, plan, taskId);
  if (!root) throw new Error(`XIAONENG_TASK_ARTIFACT_ROOT_UNAVAILABLE: ${taskId}`);
  const files: JsonRecord = {};
  const summary: JsonRecord = { taskId, stageId, files: [] };
  const evidence: GatePassEvidence[] = [];
  for (const name of required) {
    const filePath = path.join(root, name);
    if (!(await pathExists(filePath))) throw new Error(`XIAONENG_TASK_ARTIFACT_REQUIRED: ${name}`);
    const raw = await readFile(filePath, 'utf8');
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`XIAONENG_TASK_ARTIFACT_INVALID: ${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
    const digest = digestJsonHex(value);
    files[name] = { path: filePath, digest, value };
    (summary.files as Array<JsonRecord>).push({ name, digest });
    evidence.push({ type: 'file', value: `xiaobai-task-artifact:${name}:${digest}` });
  }
  if (backgroundContext) {
    validateStandardPageArtifacts(files, backgroundContext, plan, taskId);
  }
  return { summary, files, evidence };
}

function validateStandardPageArtifacts(
  files: JsonRecord,
  backgroundContext: ResolvedBackgroundContext,
  plan: RuntimePlan,
  taskId: string
): void {
  const pageContract = requiredArtifactRecord(files, 'page-contract.json');
  if (pageContract) {
    const schemaDocument = backgroundContext.documents.find((document) =>
      document.path.endsWith('standard-page-contract.schema.json')
    );
    if (!schemaDocument) throw new Error('XIAONENG_PAGE_CONTRACT_SCHEMA_REQUIRED: evidence schema is missing');
    let schema: unknown;
    try {
      schema = JSON.parse(schemaDocument.content) as unknown;
    } catch (error) {
      throw new Error(`XIAONENG_PAGE_CONTRACT_SCHEMA_INVALID: ${error instanceof Error ? error.message : String(error)}`);
    }
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema as AnySchema);
    if (!validate(pageContract)) {
      throw new Error(`XIAONENG_PAGE_CONTRACT_SCHEMA_FAILED: ${JSON.stringify(validate.errors ?? [])}`);
    }
    const contract = pageContract as JsonRecord;
    const project = plan.projectRoute;
    const repositoryId = project?.resolution.matchedRepositoryId;
    if (contract.taskId !== taskId) throw new Error('XIAONENG_PAGE_CONTRACT_TASK_MISMATCH');
    if (contract.projectId !== backgroundContext.projectId) throw new Error('XIAONENG_PAGE_CONTRACT_PROJECT_MISMATCH');
    if (repositoryId && contract.repositoryId !== repositoryId) {
      throw new Error('XIAONENG_PAGE_CONTRACT_REPOSITORY_MISMATCH');
    }
    if (contract.contextDigest !== backgroundContext.skillContext.contextDigest) {
      throw new Error('XIAONENG_CONTEXT_DIGEST_MISMATCH: page contract contextDigest differs from locked context');
    }
    const { contractDigest, ...contractWithoutDigest } = contract;
    if (contractDigest !== digestJsonHex(contractWithoutDigest)) {
      throw new Error('XIAONENG_CONTRACT_DIGEST_MISMATCH: page contract digest does not match canonical content');
    }
  }

  const backgroundLock = requiredArtifactRecord(files, 'background-context.json');
  if (backgroundLock) {
    if (
      backgroundLock.kind !== 'BackgroundContextLock' ||
      backgroundLock.version !== 1 ||
      backgroundLock.taskId !== taskId ||
      backgroundLock.projectId !== backgroundContext.projectId ||
      backgroundLock.backgroundId !== backgroundContext.backgroundId ||
      backgroundLock.skillCommit !== backgroundContext.skillContext.skillCommit ||
      backgroundLock.contextDigest !== backgroundContext.skillContext.contextDigest ||
      !Array.isArray(backgroundLock.selectedEvidenceBundles) ||
      digestJsonHex(backgroundLock.selectedEvidenceBundles) !==
        digestJsonHex(backgroundContext.skillContext.evidenceBundles ?? [])
    ) {
      throw new Error('XIAONENG_CONTEXT_LOCK_MISMATCH: background-context artifact differs from locked context');
    }
  }

  const evidenceSelection = requiredArtifactRecord(files, 'evidence-selection.json');
  if (evidenceSelection) {
    if (
      evidenceSelection.kind !== 'XiaonengEvidenceSelection' ||
      evidenceSelection.version !== 1 ||
      evidenceSelection.taskId !== taskId ||
      evidenceSelection.projectId !== backgroundContext.projectId ||
      evidenceSelection.backgroundId !== backgroundContext.backgroundId ||
      evidenceSelection.skillCommit !== backgroundContext.skillContext.skillCommit ||
      evidenceSelection.contextDigest !== backgroundContext.skillContext.contextDigest ||
      !Array.isArray(evidenceSelection.bundles) ||
      digestJsonHex(evidenceSelection.bundles) !== digestJsonHex(backgroundContext.skillContext.evidenceBundles ?? [])
    ) {
      throw new Error('XIAONENG_EVIDENCE_SELECTION_MISMATCH');
    }
  }

  const importRuleArtifact = requiredArtifactRecord(files, 'import-rule.json');
  if (importRuleArtifact) {
    if (!pageContract) throw new Error('XIAONENG_PAGE_CONTRACT_REQUIRED: import-rule requires page-contract');
    validateImportRule(pageContract, importRuleArtifact, backgroundContext);
  }
}

function requiredArtifactRecord(files: JsonRecord, name: string): JsonRecord | undefined {
  const artifact = files[name];
  if (artifact === undefined) return undefined;
  if (!isRecord(artifact) || !isRecord(artifact.value)) {
    throw new Error(`XIAONENG_TASK_ARTIFACT_INVALID: ${name} must contain a JSON object`);
  }
  return artifact.value;
}

function validateImportRule(
  contract: JsonRecord,
  artifact: JsonRecord,
  backgroundContext: ResolvedBackgroundContext
): void {
  const importContract = isRecord(contract.import) ? contract.import : undefined;
  if (!importContract) throw new Error('XIAONENG_PAGE_CONTRACT_IMPORT_INVALID: import must be an object');
  const importRule = backgroundContext.documents.find((document) =>
    document.path.endsWith('tmax-standard-import.yaml')
  );
  if (!importRule) throw new Error('IMPORT_RULE_NOT_FROM_XIAONENG: source rule is missing');

  let source: unknown;
  try {
    source = YAML.parse(importRule.content) as unknown;
  } catch (error) {
    throw new Error(`IMPORT_RULE_SOURCE_INVALID: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!isRecord(source)) throw new Error('IMPORT_RULE_SOURCE_INVALID: source must be an object');
  if (importContract.enabled !== true) {
    if (
      importContract.ruleRef !== 'none' ||
      importContract.templateRef !== 'none' ||
      importContract.adapterRef !== 'none' ||
      artifact.enabled !== false
    ) {
      throw new Error('IMPORT_RULE_DISABLED_MISMATCH');
    }
    return;
  }
  if (importContract.ruleRef !== source.ruleId || importContract.ruleRef !== 'tmax-standard-import') {
    throw new Error('IMPORT_RULE_NOT_FROM_XIAONENG: unexpected ruleRef');
  }
  if (importContract.ruleVersion !== source.version) throw new Error('IMPORT_RULE_VERSION_MISMATCH');
  if (importContract.ruleSource !== source.source) throw new Error('IMPORT_RULE_SOURCE_MISMATCH');
  if (importContract.adapterRef !== source.adapter) throw new Error('IMPORT_RULE_ADAPTER_MISMATCH');
  if (importContract.sourceCommit !== backgroundContext.skillContext.skillCommit) {
    throw new Error('IMPORT_RULE_SOURCE_COMMIT_MISMATCH');
  }
  if (importContract.sourcePath !== importRule.path) {
    throw new Error('IMPORT_RULE_SOURCE_PATH_MISMATCH');
  }
  if (importContract.sourceDigest !== sha256Hex(importRule.content)) {
    throw new Error('IMPORT_RULE_SOURCE_DIGEST_MISMATCH');
  }
  if (importContract.ruleDigest !== importContract.sourceDigest) {
    throw new Error('IMPORT_RULE_DIGEST_MISMATCH');
  }
  if (
    artifact.ruleId !== source.ruleId ||
    artifact.version !== source.version ||
    artifact.pageType !== source.pageType ||
    artifact.source !== source.source ||
    artifact.adapter !== source.adapter ||
    artifact.ruleDigest !== importContract.ruleDigest ||
    artifact.sourceDigest !== importContract.sourceDigest ||
    artifact.sourcePath !== importContract.sourcePath ||
    artifact.sourceCommit !== importContract.sourceCommit
  ) {
    throw new Error('IMPORT_RULE_ARTIFACT_MISMATCH');
  }
}

class LocalRunLock {
  private constructor(
    private readonly filePath: string,
    private readonly handle: Awaited<ReturnType<typeof open>>
  ) {}

  static async acquire(memoryRoot: string, loopId: string, runId: string, executorInstance: string): Promise<LocalRunLock> {
    const filePath = path.join(memoryRoot, 'loops', loopId, 'runs', `${encodeURIComponent(runId)}.lock`);
    await mkdir(path.dirname(filePath), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(filePath, 'wx');
    } catch (error) {
      if (isErrno(error, 'EEXIST')) throw new Error(`concurrent_executor: run ${runId} is already locked`);
      throw new Error(`executor lock unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      await handle.writeFile(
        `${JSON.stringify({ executorInstance, runId, acquiredAt: new Date().toISOString() })}\n`,
        'utf8'
      );
      await handle.sync();
      return new LocalRunLock(filePath, handle);
    } catch (error) {
      await handle.close();
      await unlink(filePath).catch(() => undefined);
      throw error;
    }
  }

  async release(): Promise<void> {
    await this.handle.close();
    await unlink(this.filePath);
  }
}

function dependencyFailures(events: StageEvent[], input: ExecutionStageInput, stage: WorkflowStagePlan): string[] {
  const failures: string[] = [];
  for (const dependency of stage.dependsOn) {
    const dependencyEvents = events.filter(
      (event) => event.runId === input.runId && event.taskId === input.taskId && event.stageId === dependency
    );
    const latestAttempt = dependencyEvents.reduce((maximum, event) => Math.max(maximum, event.attempt), 0);
    const latestAttemptEvents = dependencyEvents.filter((event) => event.attempt === latestAttempt);
    const latest = latestAttemptEvents.at(-1);
    if (
      !latest ||
      validateStageEventSequence(latestAttemptEvents).length > 0 ||
      latest.eventType !== 'passed'
    ) {
      failures.push(`Dependency stage is not passed: ${dependency}`);
    }
  }
  return failures;
}

function stageOwner(stage: WorkflowStagePlan, loop: LoopSpec): string {
  return (stage.agent ?? stage.evaluator ?? loop.metadata.owner).replace(/\.agent\.yaml$/, '');
}

function stageLoopSpec(loop: LoopSpec, stage: WorkflowStagePlan): LoopSpec {
  if (!stage.agent && !stage.evaluator) throw new Error(`Stage ${stage.id} has no executor identity`);
  if (!stage.harness) throw new Error(`Stage ${stage.id} has no harness`);
  return {
    ...loop,
    generator: {
      ...loop.generator,
      agent: stage.agent ?? stage.evaluator!,
      harness: stage.harness
    }
  };
}

function executionResult(
  status: ExecutionStageResult['status'],
  adapterId: string,
  authority: ExecutionStageResult['authority'],
  reasons: string[],
  gateDecision: GateDecision | null,
  harnessResult: ExecutionStageResult['harnessResult'],
  stageEvents: StageEvent[],
  executionEvents: ExecutionEvent[],
  evaluationVerdict: EvaluationVerdict | null = null
): ExecutionStageResult {
  return {
    status,
    adapterId,
    authority,
    reasons,
    gateDecision,
    harnessResult,
    evaluationVerdict,
    stageEvents,
    stageTiming: stageEvents.length > 0 ? projectStageTiming(stageEvents, stageEvents[0]) : null,
    executionEvents
  };
}

function blockedResult(
  adapterId: string,
  authority: ExecutionStageResult['authority'],
  reasons: string[]
): ExecutionStageResult {
  return executionResult('blocked', adapterId, authority, reasons, null, null, [], []);
}

function backgroundContextEventData(context: ResolvedBackgroundContext): JsonRecord {
  return {
    projectId: context.projectId,
    backgroundId: context.backgroundId,
    contractVersion: context.skillContext.contractVersion,
    skillCommit: context.skillContext.skillCommit,
    entryPath: context.skillContext.entryPath,
    entryHash: context.skillContext.entryHash,
    manifestPath: context.skillContext.manifestPath,
    manifestDigest: context.skillContext.manifestDigest,
    contextDigest: context.skillContext.contextDigest,
    characters: context.characters,
    sources: context.documents.map((document) => ({
      path: document.path,
      roles: document.roles,
      sourceDigest: document.sourceDigest,
      contentDigest: document.contentDigest,
      selection: document.selection
    }))
  };
}

function harnessVerdictEventData(result: NonNullable<ExecutionStageResult['harnessResult']>): JsonRecord {
  return {
    status: result.status,
    agentId: result.agentId,
    harnessId: result.harnessId,
    durationMs: result.durationMs,
    checks: result.checks,
    violations: result.violations,
    validators: result.validatorResults
  };
}

function validatorVerdictEventData(result: NonNullable<ExecutionStageResult['harnessResult']>): JsonRecord[] {
  const validatorIds = new Set([
    ...result.validatorResults.map((item) => item.validatorId),
    ...result.violations.missingValidators
  ]);
  return [...validatorIds].map((validatorId) => {
    const attestation = result.validatorResults.find((item) => item.validatorId === validatorId);
    return {
      validatorId,
      status: attestation?.status ?? 'missing',
      exitCode: attestation?.exitCode ?? null,
      resultPath: attestation?.resultPath ?? null,
      resultDigest: attestation?.resultDigest ?? null,
      reasons: attestation?.reasons ?? (attestation ? [] : ['required validator result is missing'])
    };
  });
}

function otherEvidence(value: string): GatePassEvidence {
  return { type: 'other', value };
}

function summarizeHarnessViolations(result: { violations: Record<string, unknown> }): string {
  return Object.entries(result.violations)
    .filter(([, value]) => Array.isArray(value) ? value.length > 0 : value === true)
    .map(([key, value]) => `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`)
    .join('; ') || 'unknown violation';
}

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

function isExecutorAdapterResult(value: unknown): value is ExecutorAdapterResult {
  return (
    isRecord(value) &&
    (value.status === 'completed' || value.status === 'failed' || value.status === 'blocked') &&
    Array.isArray(value.evidence) &&
    value.evidence.every(isGatePassEvidence)
  );
}

function isGatePassEvidence(value: unknown): value is GatePassEvidence {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    evidenceTypes.has(value.type as HarnessEvidenceType) &&
    typeof value.value === 'string' &&
    value.value.trim().length > 0
  );
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contextLockCurrent(value: JsonRecord, taskId: string): ContextLockCurrent {
  if (!isRecord(value)) throw new Error('CONTEXT_CURRENT_MISSING: current execution tuple is required');
  const required = [
    'stage',
    'projectId',
    'repositoryId',
    'branch',
    'repositoryCommit',
    'contextPackDigest',
    'policyDigest'
  ];
  if (required.some((key) => typeof value[key] !== 'string' || value[key].trim().length === 0)) {
    throw new Error('CONTEXT_CURRENT_INVALID: current execution tuple is incomplete');
  }
  return {
    taskId,
    stage: value.stage as ContextLockCurrent['stage'],
    projectId: value.projectId as string,
    repositoryId: value.repositoryId as string,
    branch: value.branch as string,
    repositoryCommit: value.repositoryCommit as string,
    contextPackDigest: value.contextPackDigest as string,
    policyDigest: value.policyDigest as string
  };
}
