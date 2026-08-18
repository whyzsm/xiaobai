import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { EvaluatorRuntime } from '../../evaluator-runtime/src/evaluatorRuntime';
import { HarnessRuntime } from '../../harness-runtime/src/harnessRuntime';
import { GateCheckService } from '../../human-gate/src/gateCheck';
import { clientSubmissionProfileId, parseProviderRunResult } from '../../provider-runtime/src/providerRuntime';
import {
  EvaluationVerdict,
  GatePassEvidence,
  HarnessRunResult,
  JsonRecord,
  LoopSpec,
  ProviderRunResult,
  RepositoryAction,
  TaskEnvelope,
  WorkflowStagePlan
} from '../../shared/src/types';
import { TaskRuntime } from '../../task-runtime/src/taskRuntime';

const execFileAsync = promisify(execFile);

const brokeredActions = new Set<RepositoryAction>([
  'push',
  'pull_request',
  'merge',
  'protected_branch_update',
  'delete_branch',
  'delete_worktree',
  'destructive_cleanup'
]);

export interface ClientSubmissionRuntimeOptions {
  workspaceRoot: string;
  loop: LoopSpec;
  now?: () => Date;
}

export interface ClientSubmissionInput {
  taskRuntime: TaskRuntime;
  taskId: string;
  submission: JsonRecord;
  runId?: string;
  worktreePath?: string;
  stageId?: string;
}

export interface ClientSubmissionVerification {
  status: 'accepted' | 'rejected';
  runId: string;
  taskId: string;
  stageId: string;
  hostSandbox: 'external-untrusted';
  harnessResult: HarnessRunResult;
  evaluationVerdict: EvaluationVerdict;
  providerResult: ProviderRunResult;
  diffCheck: {
    status: 'passed' | 'failed' | 'skipped';
    changedFiles: string[];
    summary: string;
    reasons: string[];
    evidence: GatePassEvidence[];
  };
  policyCheck: {
    status: 'passed' | 'failed';
    reasons: string[];
    evidence: GatePassEvidence[];
  };
  reasons: string[];
  evidence: GatePassEvidence[];
}

export class ClientSubmissionRuntime {
  private readonly clock: () => Date;

  constructor(private readonly options: ClientSubmissionRuntimeOptions) {
    this.clock = options.now ?? (() => new Date());
  }

  async submit(input: ClientSubmissionInput): Promise<TaskEnvelope> {
    const task = await input.taskRuntime.require(input.taskId);
    const runId = input.runId ?? task.runId ?? `client-${task.taskId}`;
    const gateDecision = await GateCheckService.forMemoryRoot(
      this.options.loop,
      input.taskRuntime.memoryRoot()
    ).check({
      runId,
      taskId: task.taskId,
      stageId: input.stageId,
      actions: protectedGateActions(this.options.loop, task.requestedActions),
      subject: task.subject,
      now: this.clock()
    });
    if (gateDecision.status === 'blocked') {
      throw new Error(`GATE_CHECK_BLOCKED: ${gateDecision.blockingReasons.join('; ')}`);
    }
    const submitted = await input.taskRuntime.transition({
      taskId: task.taskId,
      eventType: 'task/submitted',
      state: 'submitted',
      actor: 'entrypoint',
      data: {
        submission: input.submission,
        trustBoundary: 'external-client-untrusted'
      },
      evidence: [
        { type: 'other', value: 'client submission received as untrusted input' },
        ...gateDecision.passes.flatMap((pass) => pass.evidence)
      ]
    });
    await input.taskRuntime.transition({
      taskId: task.taskId,
      eventType: 'task/verifying',
      state: 'verifying',
      actor: 'runtime',
      data: {
        requiredVerification: ['harness', 'evaluator', 'diff', 'policy'],
        trustBoundary: 'external-client-untrusted'
      },
      evidence: [{ type: 'other', value: 'client submission revalidation started' }]
    });

    const verification = await this.verify({
      task: submitted,
      submission: input.submission,
      runId,
      worktreePath: input.worktreePath,
      stageId: input.stageId
    });

    return input.taskRuntime.transition({
      taskId: task.taskId,
      eventType: verification.status === 'accepted' ? 'task/ready_to_merge' : 'task/failed',
      state: verification.status === 'accepted' ? 'ready_to_merge' : 'failed',
      actor: 'evaluator',
      data: {
        clientSubmissionVerification: verification
      },
      evidence: verification.evidence
    });
  }

  async verify(input: {
    task: TaskEnvelope;
    submission: JsonRecord;
    runId?: string;
    worktreePath?: string;
    stageId?: string;
  }): Promise<ClientSubmissionVerification> {
    const runId = input.runId ?? input.task.runId ?? stringValue(input.submission.runId) ?? `client-${input.task.taskId}`;
    const stage = this.resolveVerificationStage(input.stageId);
    const harness = await new HarnessRuntime(this.options.workspaceRoot).load(this.options.loop);
    const harnessResult = new HarnessRuntime(this.options.workspaceRoot).evaluateRun(
      this.options.loop,
      harness,
      input.submission
    );
    const diffCheck = await this.inspectDiff(input.task, input.worktreePath);
    const policyCheck = this.checkPolicy(input.task, input.submission, diffCheck.changedFiles);
    const baseEvidence = [
      { type: 'other' as const, value: 'client-submission:host-sandbox=external-untrusted' },
      ...diffCheck.evidence,
      ...policyCheck.evidence
    ];
    const evaluationVerdict = new EvaluatorRuntime().decide({
      loop: this.options.loop,
      stage,
      runId,
      taskId: input.task.taskId,
      harnessResult,
      evidence: baseEvidence
    });

    const reasons = [
      ...(harnessResult.status === 'passed' ? [] : ['Harness rejected client submission']),
      ...(evaluationVerdict.decision === 'approved' ? [] : ['Independent evaluator rejected client submission']),
      ...diffCheck.reasons,
      ...policyCheck.reasons
    ];
    const status = reasons.length === 0 ? 'accepted' : 'rejected';
    const finishedAt = this.clock().toISOString();
    const providerResult = parseProviderRunResult({
      taskId: input.task.taskId,
      providerProfileId: input.task.providerProfileId ?? clientSubmissionProfileId,
      status: status === 'accepted' ? 'completed' : 'failed',
      startedAt: stringValue(input.submission.startedAt) ?? input.task.updatedAt,
      finishedAt,
      output: {
        changedFiles: diffCheck.changedFiles,
        diffSummary: diffCheck.summary,
        verificationCommands: [
          'harness:evaluate-submission',
          'evaluator:independent-decision',
          ...(input.worktreePath ? ['git diff --name-only HEAD --', 'git ls-files --others --exclude-standard'] : []),
          'policy:client-submission'
        ],
        harnessStatus: harnessResult.status,
        evaluatorDecision: evaluationVerdict.decision,
        policyStatus: policyCheck.status,
        hostSandbox: 'external-untrusted'
      },
      evidence: baseEvidence,
      reason: status === 'accepted' ? undefined : reasons.join('; ')
    });

    return {
      status,
      runId,
      taskId: input.task.taskId,
      stageId: stage.id,
      hostSandbox: 'external-untrusted',
      harnessResult,
      evaluationVerdict,
      providerResult,
      diffCheck,
      policyCheck,
      reasons,
      evidence: [
        ...baseEvidence,
        { type: 'review', value: `harness=${harnessResult.status}; evaluator=${evaluationVerdict.decision}` },
        ...(status === 'accepted'
          ? [{ type: 'review' as const, value: 'client submission accepted after revalidation' }]
          : [{ type: 'review' as const, value: `client submission rejected: ${reasons.join('; ')}` }])
      ]
    };
  }

  private resolveVerificationStage(stageId?: string): WorkflowStagePlan {
    const configured = stageId
      ? this.options.loop.workflow?.stages.find((stage) => stage.id === stageId)
      : undefined;
    if (stageId && !configured) throw new Error(`Unknown client submission verification stage: ${stageId}`);
    if (configured) {
      if (!configured.evaluator) throw new Error(`Client submission verification stage requires evaluator: ${stageId}`);
      return {
        id: configured.id,
        kind: configured.kind,
        status: 'planned',
        gate: configured.gate ?? 'automatic',
        evaluator: configured.evaluator,
        harness: configured.harness,
        dependsOn: configured.dependsOn ?? [],
        requiredChecks: configured.requiredChecks ?? [],
        requiredGates: configured.requiredGates ?? [],
        requiredBefore: configured.requiredBefore ?? [],
        outputs: configured.outputs ?? []
      };
    }
    return {
      id: 'client-submission-verification',
      kind: 'review',
      status: 'planned',
      gate: 'automatic',
      evaluator: this.options.loop.verification.evaluator,
      harness: this.options.loop.generator.harness,
      dependsOn: [],
      requiredChecks: [...this.options.loop.verification.requiredChecks],
      requiredGates: [],
      requiredBefore: [],
      outputs: ['clientSubmissionVerification']
    };
  }

  private async inspectDiff(
    task: TaskEnvelope,
    worktreePath?: string
  ): Promise<ClientSubmissionVerification['diffCheck']> {
    const writeRequested = task.requestedActions.some((action) => action !== 'read');
    if (!writeRequested) {
      return {
        status: 'skipped',
        changedFiles: [],
        summary: 'diff inspection skipped for read-only task',
        reasons: [],
        evidence: [{ type: 'diff', value: 'client-submission:diff-not-required-for-read-only-task' }]
      };
    }
    if (!worktreePath) {
      return {
        status: 'failed',
        changedFiles: [],
        summary: 'diff inspection failed because no worktree path was provided',
        reasons: ['Writable client submission requires a worktree path for diff inspection'],
        evidence: [{ type: 'diff', value: 'client-submission:missing-worktree-path' }]
      };
    }

    const cwd = path.resolve(worktreePath);
    try {
      const tracked = await execFileAsync('git', ['diff', '--name-only', 'HEAD', '--'], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });
      const untracked = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard'], {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        maxBuffer: 1024 * 1024
      });
      const changedFiles = unique([
        ...tracked.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        ...untracked.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
      ]);
      const summary = changedFiles.length > 0
        ? `changed files: ${changedFiles.join(', ')}`
        : 'no changed files detected';
      return {
        status: changedFiles.length > 0 ? 'passed' : 'failed',
        changedFiles,
        summary,
        reasons: changedFiles.length > 0 ? [] : ['Writable client submission has no inspected diff'],
        evidence: [
          { type: 'command', value: `git diff --name-only HEAD -- @ ${cwd}` },
          { type: 'command', value: `git ls-files --others --exclude-standard @ ${cwd}` },
          { type: 'diff', value: summary }
        ]
      };
    } catch (error) {
      const reason = `Diff inspection failed: ${error instanceof Error ? error.message : String(error)}`;
      return {
        status: 'failed',
        changedFiles: [],
        summary: reason,
        reasons: [reason],
        evidence: [{ type: 'diff', value: reason }]
      };
    }
  }

  private checkPolicy(
    task: TaskEnvelope,
    submission: JsonRecord,
    inspectedChangedFiles: string[]
  ): ClientSubmissionVerification['policyCheck'] {
    const reasons: string[] = [];
    const blockedActions = task.requestedActions.filter((action) => brokeredActions.has(action));
    if (blockedActions.length > 0) {
      reasons.push(`Client submission cannot directly authorize brokered actions: ${blockedActions.join(', ')}`);
    }
    const reportedChangedFiles = readReportedChangedFiles(submission);
    const unsafeFiles = [...reportedChangedFiles, ...inspectedChangedFiles].filter(isUnsafeRelativePath);
    if (unsafeFiles.length > 0) {
      reasons.push(`Client submission reported unsafe changed file paths: ${unique(unsafeFiles).join(', ')}`);
    }

    return {
      status: reasons.length === 0 ? 'passed' : 'failed',
      reasons,
      evidence: [
        { type: 'other', value: 'policy:client-submission-host-sandbox-is-external' },
        { type: 'other', value: `policy:brokered-actions=${blockedActions.join(',') || 'none'}` },
        { type: 'other', value: `policy:unsafe-paths=${unsafeFiles.join(',') || 'none'}` }
      ]
    };
  }
}

function protectedGateActions(loop: LoopSpec, actions: RepositoryAction[]): string[] {
  const protectedActions = new Set(loop.humanGate.gates.map((gate) => gate.requiredBefore));
  return actions.filter((action) => protectedActions.has(action));
}

function readReportedChangedFiles(submission: JsonRecord): string[] {
  if (!isRecord(submission.output)) return [];
  const changedFiles = submission.output.changedFiles;
  return Array.isArray(changedFiles)
    ? changedFiles.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function isUnsafeRelativePath(value: string): boolean {
  return path.isAbsolute(value) || value.split(/[\\/]+/).includes('..');
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
