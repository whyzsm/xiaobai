import { randomUUID } from 'node:crypto';
import { mkdir, open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { EvaluatorRuntime } from '../../evaluator-runtime/src/evaluatorRuntime';
import { HarnessRuntime, specializeHarnessForStage } from '../../harness-runtime/src/harnessRuntime';
import { GatePassStore, HumanGate } from '../../human-gate/src/humanGate';
import { SkillContextResolver } from '../../skill-context-runtime/src/skillContextResolver';
import {
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
import { ExecutionEventStore } from './executionEvents';
import { createStageEvent, StageEventStore, validateStageEventSequence } from './stageEvents';

export interface ExecutionRuntimeOptions {
  workspaceRoot: string;
  memoryRoot: string;
  loop: LoopSpec;
  plan: RuntimePlan;
  executorInstance?: string;
  now?: () => Date;
}

export class GateGuard {
  private readonly humanGate: HumanGate;

  constructor(
    private readonly loop: LoopSpec,
    private readonly passStore: GatePassStore
  ) {
    this.humanGate = new HumanGate(loop);
  }

  async check(input: GateCheckInput): Promise<GateDecision> {
    const preliminary = this.humanGate.check(input, []);
    if (preliminary.status === 'passed' && preliminary.requiredGates.length === 0) {
      return preliminary;
    }

    try {
      return this.humanGate.check(input, await this.passStore.readAll());
    } catch (error) {
      return {
        status: 'blocked',
        requiredGates: preliminary.requiredGates,
        satisfiedGates: [],
        blockingReasons: [
          ...preliminary.blockingReasons,
          `GatePass store unavailable: ${error instanceof Error ? error.message : String(error)}`
        ],
        passes: []
      };
    }
  }
}

export class ExecutionRuntime {
  private readonly stageStore: StageEventStore;
  private readonly gateGuard: GateGuard;
  private readonly executorInstance: string;
  private readonly clock: () => Date;

  constructor(private readonly options: ExecutionRuntimeOptions) {
    if (options.loop.metadata.id !== options.plan.loopId) {
      throw new Error(`Runtime plan loop does not match loop spec: ${options.plan.loopId}`);
    }
    this.stageStore = new StageEventStore(options.memoryRoot, options.loop.metadata.id);
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
      return await this.executeLocked(input, adapter, authority);
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
      event: Omit<Parameters<ExecutionEventStore['append']>[0], keyof StageEventKey>
    ): Promise<ExecutionEvent> => {
      const recordedEvent = await executionStore.append({
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
      subject: input.subject
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
    if (this.options.plan.backgroundContext) {
      try {
        backgroundContext = await new SkillContextResolver(this.options.workspaceRoot).resolve(
          this.options.plan.backgroundContext
        );
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
        subject: input.subject,
        workspaceRoot: this.options.workspaceRoot,
        worktreePath: input.worktreePath,
        ...(backgroundContext ? { backgroundContext } : {}),
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
    violations: result.violations
  };
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
  return typeof value === 'object' && value !== null;
}
