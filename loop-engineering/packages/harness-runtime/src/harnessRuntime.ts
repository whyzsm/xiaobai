import path from 'node:path';
import {
  AgentRunPlan,
  HarnessEvidenceType,
  HarnessRunEvidence,
  HarnessRunResult,
  HarnessRunSubmission,
  HarnessSpec,
  JsonRecord,
  LoopSpec,
  WorktreePlan
} from '../../shared/src/types';
import { readYamlFile } from '../../shared/src/fs';

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

export class HarnessRuntime {
  constructor(private readonly workspaceRoot: string) {}

  async load(loop: LoopSpec): Promise<HarnessSpec> {
    return readYamlFile<HarnessSpec>(path.join(this.workspaceRoot, 'agents', loop.generator.harness));
  }

  planGeneratorRuns(loop: LoopSpec, harness: HarnessSpec, worktrees: WorktreePlan[]): AgentRunPlan[] {
    return worktrees.map((worktree) => ({
      taskId: worktree.taskId,
      agentId: loop.generator.agent.replace(/\.agent\.yaml$/, ''),
      harnessId: harness.metadata.id,
      worktreePath: worktree.path,
      expectedOutput: harness.output.required
    }));
  }

  evaluateRun(loop: LoopSpec, harness: HarnessSpec, value: unknown): HarnessRunResult {
    const { submission, errors: submissionErrors } = normalizeSubmission(value);
    const expectedAgentId = loop.generator.agent.replace(/\.agent\.yaml$/, '');
    const identityErrors: string[] = [];
    if (submission.agentId !== expectedAgentId) {
      identityErrors.push(`Expected agent ${expectedAgentId}, received ${submission.agentId || '<missing>'}`);
    }
    if (submission.harnessId !== harness.metadata.id) {
      identityErrors.push(`Expected harness ${harness.metadata.id}, received ${submission.harnessId || '<missing>'}`);
    }

    const loadedContext = new Set(submission.loadedContext);
    const missingContextLoaders = harness.context.loaders.filter((loader) => !loadedContext.has(loader));
    const contextLimitExceeded = submission.contextCharactersUsed > harness.context.maxCharacters;

    const toolsUsed = unique(submission.toolsUsed);
    const deniedTools = toolsUsed.filter((tool) => harness.tools.deny.includes(tool));
    const unallowedTools = toolsUsed.filter((tool) => !harness.tools.allow.includes(tool));

    const completedConditions = new Set(submission.completedConditions);
    const missingConditions = harness.completion.conditions.filter((condition) => !completedConditions.has(condition));
    const unknownConditions = unique(submission.completedConditions).filter(
      (condition) => !harness.completion.conditions.includes(condition)
    );
    const missingOutputs = harness.output.required.filter((field) => !hasOutput(submission.output, field));

    const evidencedChecks = new Set(submission.evidence.map((item) => item.checkId));
    const missingEvidence = harness.completion.conditions.filter(
      (condition) => completedConditions.has(condition) && !evidencedChecks.has(condition)
    );

    const checks = {
      identity: identityErrors.length === 0,
      context: missingContextLoaders.length === 0 && !contextLimitExceeded,
      tools: deniedTools.length === 0 && unallowedTools.length === 0,
      completion: missingConditions.length === 0 && unknownConditions.length === 0,
      output: missingOutputs.length === 0,
      evidence: missingEvidence.length === 0
    };
    const startedAt = parseTimestamp(submission.startedAt);
    const finishedAt = parseTimestamp(submission.finishedAt);
    const durationMs = startedAt !== null && finishedAt !== null && finishedAt >= startedAt
      ? finishedAt - startedAt
      : null;
    if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
      submissionErrors.push('finishedAt must not be earlier than startedAt');
    }

    return {
      runId: submission.runId,
      taskId: submission.taskId,
      agentId: submission.agentId,
      harnessId: submission.harnessId,
      status: submissionErrors.length === 0 && Object.values(checks).every(Boolean) ? 'passed' : 'failed',
      startedAt: startedAt === null ? null : submission.startedAt,
      finishedAt: finishedAt === null ? null : submission.finishedAt,
      durationMs,
      checks,
      violations: {
        submissionErrors,
        identityErrors,
        missingContextLoaders,
        contextLimitExceeded,
        deniedTools,
        unallowedTools,
        missingConditions,
        unknownConditions,
        missingOutputs,
        missingEvidence
      }
    };
  }
}

function normalizeSubmission(value: unknown): { submission: HarnessRunSubmission; errors: string[] } {
  const errors: string[] = [];
  const input = isRecord(value) ? value : {};
  if (!isRecord(value)) {
    errors.push('submission must be a JSON object');
  }

  const startedAt = requiredString(input, 'startedAt', errors);
  const finishedAt = requiredString(input, 'finishedAt', errors);
  if (startedAt && parseTimestamp(startedAt) === null) {
    errors.push('startedAt must be a valid ISO-8601 timestamp');
  }
  if (finishedAt && parseTimestamp(finishedAt) === null) {
    errors.push('finishedAt must be a valid ISO-8601 timestamp');
  }

  const contextCharactersUsed = input.contextCharactersUsed;
  if (!Number.isInteger(contextCharactersUsed) || Number(contextCharactersUsed) < 0) {
    errors.push('contextCharactersUsed must be a non-negative integer');
  }

  return {
    submission: {
      runId: requiredString(input, 'runId', errors),
      taskId: requiredString(input, 'taskId', errors),
      agentId: requiredString(input, 'agentId', errors),
      harnessId: requiredString(input, 'harnessId', errors),
      startedAt,
      finishedAt,
      loadedContext: stringArray(input, 'loadedContext', errors),
      contextCharactersUsed: Number.isInteger(contextCharactersUsed) ? Number(contextCharactersUsed) : 0,
      toolsUsed: stringArray(input, 'toolsUsed', errors),
      completedConditions: stringArray(input, 'completedConditions', errors),
      output: recordValue(input, 'output', errors),
      evidence: evidenceArray(input, errors)
    },
    errors
  };
}

function requiredString(input: JsonRecord, field: string, errors: string[]): string {
  const value = input[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty string`);
    return '';
  }
  return value;
}

function stringArray(input: JsonRecord, field: string, errors: string[]): string[] {
  const value = input[field];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim().length === 0)) {
    errors.push(`${field} must be an array of non-empty strings`);
    return [];
  }
  return value;
}

function recordValue(input: JsonRecord, field: string, errors: string[]): JsonRecord {
  const value = input[field];
  if (!isRecord(value)) {
    errors.push(`${field} must be a JSON object`);
    return {};
  }
  return value;
}

function evidenceArray(input: JsonRecord, errors: string[]): HarnessRunEvidence[] {
  const value = input.evidence;
  if (!Array.isArray(value)) {
    errors.push('evidence must be an array');
    return [];
  }

  const evidence: HarnessRunEvidence[] = [];
  for (const [index, item] of value.entries()) {
    if (
      !isRecord(item) ||
      typeof item.checkId !== 'string' ||
      item.checkId.trim().length === 0 ||
      typeof item.type !== 'string' ||
      !evidenceTypes.has(item.type as HarnessEvidenceType) ||
      typeof item.value !== 'string' ||
      item.value.trim().length === 0
    ) {
      errors.push(`evidence[${index}] must contain checkId, supported type, and non-empty value`);
      continue;
    }
    evidence.push({
      checkId: item.checkId,
      type: item.type as HarnessEvidenceType,
      value: item.value
    });
  }
  return evidence;
}

function hasOutput(output: JsonRecord, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(output, field) && output[field] !== null && output[field] !== undefined;
}

function parseTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
