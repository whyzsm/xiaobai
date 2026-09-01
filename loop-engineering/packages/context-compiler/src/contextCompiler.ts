import path from 'node:path';
import { digestJsonHex } from '../../shared/src/canonicalDigest';

export type ContractKind =
  | 'RepositorySnapshot'
  | 'ContextRequest'
  | 'ContextPack'
  | 'ContextLock';

export interface ContractValidationResult {
  ok: boolean;
  errors?: Array<{ code?: string; path?: string; message?: string }>;
}

export interface NeutralContractAdapter {
  validate(kind: ContractKind, payload: unknown): ContractValidationResult;
  digest(payload: unknown): string;
  contractVersion?: string;
}

export interface RepositorySnapshotInput {
  projectId: string;
  repositoryId: string;
  branch: string;
  commit: string;
  approvedPaths: string[];
  codeFactDigest: string;
  classification: 'public' | 'internal' | 'confidential' | 'restricted';
  capturedAt: string;
  sourceRevision?: string;
}

export interface RepositorySnapshot extends RepositorySnapshotInput {
  contractVersion: string;
}

export interface ContextRequestInput {
  requestId: string;
  taskType: string;
  userGoal: string;
  project: {
    contractVersion?: string;
    projectId: string;
    displayName: string;
    projectRevision: string;
    classification: RepositorySnapshotInput['classification'];
  };
  repository: RepositorySnapshot;
  knowledgeBindings: unknown[];
  requiredCapabilities: string[];
  authorization: {
    subjectId: string;
    allowedProjects: string[];
    allowedClassifications: RepositorySnapshotInput['classification'][];
  };
  budget: { maxCharacters: number; maxItems: number };
  selectionPolicy: { strategy: 'ranked' | 'explicit'; maxItems: number; includeStale: false };
}

export interface ContextLockInput {
  contractVersion: string;
  contextLockId: string;
  taskId: string;
  stage: 'plan' | 'execute' | 'verify' | 'finish';
  projectId: string;
  repositoryId: string;
  branch: string;
  repositoryCommit: string;
  contextPackDigest: string;
  policyDigest: string;
  lockedAt: string;
}

export interface ContextLockCurrent {
  taskId: string;
  stage: ContextLockInput['stage'];
  projectId: string;
  repositoryId: string;
  branch: string;
  repositoryCommit: string;
  contextPackDigest: string;
  policyDigest: string;
}

export interface ContextPackInput {
  contractVersion: string;
  contextPackId: string;
  requestId: string;
  projectId: string;
  repositoryId: string;
  repositoryCommit: string;
  knowledgeItems?: Array<{ knowledgeItemId: string; content?: string; [key: string]: unknown }>;
  sources?: unknown[];
  conflicts?: unknown[];
  omissions?: Array<{ itemId: string; reason: string }>;
  budget?: Record<string, unknown>;
  contextDigest: string;
  generatedAt: string;
  [key: string]: unknown;
}

export interface ContextEvidence {
  contractVersion: string;
  requestDigest: string;
  contextPackDigest: string;
  lockDigest: string;
  selectedKnowledgeItemIds: string[];
  omissions: Array<{ itemId: string; reason: string }>;
  mode: 'context-pack' | 'legacy-background';
}

export class ContextCompilerError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: unknown[] = []) {
    super(`${code}: ${message}`);
    this.name = 'ContextCompilerError';
  }
}

function fail(code: string, message: string, details: unknown[] = []): never {
  throw new ContextCompilerError(code, message, details);
}

function validate(adapter: NeutralContractAdapter, kind: ContractKind, payload: unknown): void {
  const result = adapter?.validate?.(kind, payload);
  if (!result || result.ok !== true) fail('CONTRACT_VALIDATION_FAILED', `${kind} was rejected`, result?.errors || []);
}

function contractVersion(adapter: NeutralContractAdapter): string {
  const version = adapter.contractVersion || '1.0';
  if (!/^1\.(0|[1-9][0-9]*)$/.test(version)) fail('CONTRACT_VERSION_UNSUPPORTED', `unsupported contract version: ${version}`);
  return version;
}

function assertRelativePaths(paths: string[]): void {
  if (!Array.isArray(paths) || paths.length === 0) fail('REPOSITORY_PATHS_MISSING', 'approvedPaths must contain at least one relative path');
  for (const approvedPath of paths) {
    if (typeof approvedPath !== 'string' || path.isAbsolute(approvedPath) || approvedPath.includes('\\') || approvedPath.split('/').some((segment) => segment === '..' || segment === '.')) {
      fail('REPOSITORY_PATH_NOT_RELATIVE', `approved path is not a safe relative path: ${approvedPath}`);
    }
  }
}

export function captureRepositorySnapshot(input: RepositorySnapshotInput, adapter: NeutralContractAdapter): RepositorySnapshot {
  if (!input || !adapter) fail('CONTEXT_COMPILER_INPUT_MISSING', 'snapshot input and contract adapter are required');
  assertRelativePaths(input.approvedPaths);
  if (!/^[0-9a-f]{7,64}$/.test(input.commit)) fail('REPOSITORY_COMMIT_INVALID', 'repository commit must be a hexadecimal revision');
  if (!/^[a-f0-9]{64}$/.test(input.codeFactDigest)) fail('CODE_FACT_DIGEST_INVALID', 'codeFactDigest must be a SHA-256 hex digest');
  const snapshot: RepositorySnapshot = {
    ...input,
    contractVersion: contractVersion(adapter),
    approvedPaths: [...new Set(input.approvedPaths)].sort(),
  };
  validate(adapter, 'RepositorySnapshot', snapshot);
  return Object.freeze(snapshot);
}

export function compileContextRequest(input: ContextRequestInput, adapter: NeutralContractAdapter): ContextRequestInput & { contractVersion: string } {
  if (!input || !adapter) fail('CONTEXT_COMPILER_INPUT_MISSING', 'request input and contract adapter are required');
  const version = contractVersion(adapter);
  if (input.project.projectId !== input.repository.projectId) fail('PROJECT_REPOSITORY_MISMATCH', 'project and repository snapshot must share projectId');
  if (!input.authorization.allowedProjects.includes(input.project.projectId)) fail('PROJECT_NOT_AUTHORIZED', 'request project is not in authorization allowlist');
  const request = {
    ...input,
    contractVersion: version,
    project: { ...input.project, contractVersion: version },
    repository: { ...input.repository, contractVersion: version },
    knowledgeBindings: input.knowledgeBindings.map((binding) => ({ ...binding as object, contractVersion: version })),
  };
  validate(adapter, 'ContextRequest', request);
  return Object.freeze(request);
}

export function validateContextLock(lock: ContextLockInput | null | undefined, current: ContextLockCurrent, adapter: NeutralContractAdapter): void {
  if (!lock) fail('CONTEXT_LOCK_MISSING', 'a ContextLock is required before writable execution');
  validate(adapter, 'ContextLock', lock);
  const drift = (['taskId', 'stage', 'projectId', 'repositoryId', 'branch', 'repositoryCommit', 'contextPackDigest', 'policyDigest'] as const)
    .filter((key) => lock[key] !== current[key])
    .map((key) => ({ key, locked: lock[key], current: current[key] }));
  if (drift.length) fail('CONTEXT_LOCK_DRIFT', 'ContextLock no longer matches the current execution tuple', drift);
}

export function validateContextRequest(request: unknown, adapter: NeutralContractAdapter): void {
  if (!request || typeof request !== 'object') fail('CONTEXT_REQUEST_MISSING', 'a ContextRequest is required before writable execution');
  validate(adapter, 'ContextRequest', request);
}

export function validateContextPack(pack: unknown, adapter: NeutralContractAdapter): asserts pack is ContextPackInput {
  if (!pack || typeof pack !== 'object') fail('CONTEXT_PACK_MISSING', 'a ContextPack is required before writable execution');
  validate(adapter, 'ContextPack', pack);
  const value = pack as Record<string, unknown>;
  const contextDigest = value.contextDigest;
  if (typeof contextDigest !== 'string' || contextDigest.length === 0) {
    fail('CONTEXT_PACK_DIGEST_MISSING', 'ContextPack contextDigest is required before writable execution');
  }
  const { contextDigest: _contextDigest, ...unsealedPack } = value;
  if (adapter.digest(unsealedPack) !== contextDigest) {
    fail('CONTEXT_PACK_DIGEST_MISMATCH', 'ContextPack digest does not match canonical content');
  }
}

export function projectContextEvidence(
  request: Record<string, unknown>,
  pack: { contextDigest: string; knowledgeItems?: Array<{ knowledgeItemId: string }>; omissions?: Array<{ itemId: string; reason: string }> },
  lock: ContextLockInput,
  mode: ContextEvidence['mode'],
  adapter: NeutralContractAdapter,
): ContextEvidence {
  if (mode === 'context-pack' && !pack.contextDigest) fail('CONTEXT_PACK_DIGEST_MISSING', 'ContextPack digest is required for evidence');
  if (mode === 'legacy-background' && pack.contextDigest) fail('CONTEXT_MODE_CONFLICT', 'legacy background evidence cannot include a ContextPack digest');
  return {
    contractVersion: contractVersion(adapter),
    requestDigest: adapter.digest(request),
    contextPackDigest: pack.contextDigest || '',
    lockDigest: adapter.digest(lock),
    selectedKnowledgeItemIds: (pack.knowledgeItems || []).map((item) => item.knowledgeItemId),
    omissions: [...(pack.omissions || [])],
    mode,
  };
}

export function defaultDigestAdapter(): NeutralContractAdapter {
  return {
    contractVersion: '1.0',
    validate: () => ({ ok: true }),
    digest: digestJsonHex,
  };
}
