import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { HarnessEvidenceType, JsonRecord } from '../../shared/src/types';

export type ValidatorRuntimeStatus = 'passed' | 'failed' | 'skipped';

export interface ValidatorRuntimeInput {
  projectRoot: string;
  taskId: string;
  phase: string;
  contractPath: string;
  contextDigest: string;
  validatorId?: string;
  featureFlag?: string;
}

export interface ValidatorRuntimeEvidence {
  type: HarnessEvidenceType;
  value: string;
}

export interface ValidatorRuntimeResult {
  kind: 'ValidatorRuntimeResult';
  version: 1;
  validatorId: string;
  taskId: string;
  phase: string;
  contractPath: string;
  contextDigest: string;
  status: ValidatorRuntimeStatus;
  reasons: string[];
  evidence: ValidatorRuntimeEvidence[];
}

export interface ValidatorExecutorInput extends ValidatorRuntimeInput {
  contract: JsonRecord;
}

export interface ValidatorExecutorResult {
  status: 'passed' | 'failed';
  reasons?: string[];
  evidence?: ValidatorRuntimeEvidence[];
}

export type ValidatorExecutor = (
  input: ValidatorExecutorInput
) => ValidatorExecutorResult | Promise<ValidatorExecutorResult>;

export interface ValidatorRuntimeOptions {
  featureFlags?: Record<string, boolean>;
  executors?: Record<string, ValidatorExecutor>;
}

export class ValidatorRuntime {
  private readonly featureFlags: Record<string, boolean>;
  private readonly executors: Record<string, ValidatorExecutor>;

  constructor(options: ValidatorRuntimeOptions = {}) {
    this.featureFlags = { ...(options.featureFlags ?? {}) };
    this.executors = { ...(options.executors ?? {}) };
  }

  async run(input: ValidatorRuntimeInput): Promise<ValidatorRuntimeResult> {
    const validatorId = input.validatorId ?? 'contract-context';
    const featureFlag = input.featureFlag ?? `validator:${validatorId}`;
    const base = {
      validatorId,
      taskId: input.taskId,
      phase: input.phase,
      contractPath: input.contractPath,
      contextDigest: input.contextDigest
    };

    if (this.featureFlags[featureFlag] === false) {
      return {
        kind: 'ValidatorRuntimeResult',
        version: 1,
        ...base,
        status: 'skipped',
        reasons: [`Validator disabled by feature flag: ${featureFlag}`],
        evidence: [{ type: 'other', value: `validator-skipped:${featureFlag}` }]
      };
    }

    let contract: JsonRecord;
    let contractPath: string;
    try {
      contractPath = resolveContractPath(input.projectRoot, input.contractPath);
      contract = JSON.parse(await readFile(contractPath, 'utf8')) as JsonRecord;
    } catch (error) {
      return {
        kind: 'ValidatorRuntimeResult',
        version: 1,
        ...base,
        status: 'failed',
        reasons: [`Contract unavailable: ${input.contractPath} (${errorMessage(error)})`],
        evidence: [{ type: 'file', value: `contract-missing:${input.contractPath}` }]
      };
    }

    if (!isRecord(contract)) {
      return {
        kind: 'ValidatorRuntimeResult',
        version: 1,
        ...base,
        status: 'failed',
        reasons: ['Contract must be a JSON object'],
        evidence: [{ type: 'file', value: `contract-read:${input.contractPath}` }]
      };
    }

    const executor = this.executors[validatorId];
    let execution: ValidatorExecutorResult;
    try {
      execution = executor
        ? await executor({ ...input, validatorId, contract })
        : validateContractContext(input, contract);
    } catch (error) {
      execution = {
        status: 'failed',
        reasons: [`Validator execution failed: ${errorMessage(error)}`],
        evidence: [{ type: 'other', value: `validator-error:${validatorId}` }]
      };
    }
    const evidence = [
      { type: 'file' as const, value: `contract-read:${input.contractPath}` },
      { type: 'other' as const, value: `context-digest:${input.contextDigest}` },
      ...(execution.evidence ?? [])
    ];

    return {
      kind: 'ValidatorRuntimeResult',
      version: 1,
      ...base,
      status: execution.status,
      reasons: execution.reasons ?? [],
      evidence
    };
  }
}

function validateContractContext(
  input: ValidatorRuntimeInput,
  contract: JsonRecord
): ValidatorExecutorResult {
  const reasons: string[] = [];
  if (contract.taskId !== undefined && contract.taskId !== input.taskId) {
    reasons.push(`Contract taskId mismatch: expected ${input.taskId}, received ${String(contract.taskId)}`);
  }
  if (contract.contextDigest !== input.contextDigest) {
    reasons.push(
      `Contract contextDigest mismatch: expected ${input.contextDigest}, received ${String(contract.contextDigest)}`
    );
  }
  return {
    status: reasons.length === 0 ? 'passed' : 'failed',
    reasons
  };
}

function resolveContractPath(projectRoot: string, contractPath: string): string {
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(root, contractPath);
  const relative = path.relative(root, resolved);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`Contract path escapes project root: ${contractPath}`);
  }
  return resolved;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
