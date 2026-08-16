import {
  BrokerDecision,
  BrokerDecisionStatus,
  GatePassEvidence,
  HarnessEvidenceType,
  JsonRecord,
  MergeQueueState,
  PromotionPlan,
  ProviderMode,
  ProviderProfile,
  ProviderRunRequest,
  ProviderRunResult,
  ProviderSandboxProfile,
  ProviderSupportLevel,
  ProviderTransport,
  RepositoryAction,
  TaskEntryPoint,
  TaskEnvelope,
  TaskEvent,
  TaskEventType,
  TaskRequest,
  TaskState,
  WorkspaceLease,
  WorkspaceLeaseDirtyPolicy,
  WorkspaceLeaseHeartbeat,
  WorkspaceLeaseOwner,
  WorkspaceLeaseOwnerRole,
  WorkspaceLeaseState
} from './types';

const taskEntryPoints = new Set<TaskEntryPoint>(['cli', 'mcp', 'acp', 'http']);
const taskStates = new Set<TaskState>([
  'created',
  'prepared',
  'leased',
  'running',
  'submitted',
  'verifying',
  'ready_to_merge',
  'merged',
  'blocked',
  'failed'
]);
const providerModes = new Set<ProviderMode>(['managed', 'client']);
const repositoryActions = new Set<RepositoryAction>([
  'read',
  'write',
  'push',
  'pull_request',
  'merge',
  'protected_branch_update',
  'delete_branch',
  'delete_worktree',
  'destructive_cleanup'
]);
const taskEventTypes = new Set<TaskEventType>([
  'task/created',
  'task/prepared',
  'task/leased',
  'task/running',
  'task/submitted',
  'task/verifying',
  'task/ready_to_merge',
  'task/merged',
  'task/blocked',
  'task/failed',
  'task/cancelled'
]);
const taskActors = new Set(['runtime', 'entrypoint', 'provider', 'broker', 'evaluator', 'human']);
const leaseStates = new Set<WorkspaceLeaseState>([
  'prepared',
  'claimed',
  'active',
  'stale',
  'released',
  'failed',
  'dirty_retained'
]);
const leaseOwnerRoles = new Set<WorkspaceLeaseOwnerRole>(['writer', 'reader']);
const dirtyPolicies = new Set<WorkspaceLeaseDirtyPolicy>(['retain_dirty', 'delete_when_clean']);
const transports = new Set<ProviderTransport>(['cli', 'stdio', 'mcp', 'http', 'client']);
const supportLevels = new Set<ProviderSupportLevel>(['supported', 'experimental', 'client_only']);
const sandboxProfiles = new Set<ProviderSandboxProfile>(['read-only', 'workspace-write', 'external', 'none']);
const brokerStatuses = new Set<BrokerDecisionStatus>(['authorized', 'blocked', 'completed', 'failed']);
const mergeQueueStates = new Set<MergeQueueState>(['queued', 'checking', 'blocked', 'ready', 'merged', 'failed']);
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

export function validateTaskRequest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['TaskRequest must be an object'];
  if (!taskEntryPoints.has(value.entryPoint as TaskEntryPoint)) errors.push('entryPoint must be a supported entry point');
  requireString(value, 'projectId', errors);
  if (value.repositoryId !== undefined && !isNonEmptyString(value.repositoryId)) {
    errors.push('repositoryId must be a non-empty string when provided');
  }
  if (!isRecord(value.subject)) errors.push('subject must be a JSON object');
  errors.push(...validateActionArray(value.requestedActions, 'requestedActions'));
  if (value.provider !== undefined) {
    if (!isRecord(value.provider)) {
      errors.push('provider must be an object when provided');
    } else if (value.provider.mode !== undefined && !providerModes.has(value.provider.mode as ProviderMode)) {
      errors.push('provider.mode must be managed or client');
    }
  }
  return errors;
}

export function validateTaskEnvelope(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['TaskEnvelope must be an object'];
  if (value.kind !== 'TaskEnvelope') errors.push('kind must be TaskEnvelope');
  if (value.version !== 1) errors.push('version must be 1');
  requireString(value, 'taskId', errors);
  if (!taskStates.has(value.state as TaskState)) errors.push('state must be a supported task state');
  if (!taskEntryPoints.has(value.entryPoint as TaskEntryPoint)) errors.push('entryPoint must be a supported entry point');
  requireString(value, 'projectId', errors);
  if (!isRecord(value.subject)) errors.push('subject must be a JSON object');
  errors.push(...validateActionArray(value.requestedActions, 'requestedActions'));
  if (!providerModes.has(value.providerMode as ProviderMode)) errors.push('providerMode must be managed or client');
  if (!Array.isArray(value.gateRequirements) || !value.gateRequirements.every(isNonEmptyString)) {
    errors.push('gateRequirements must be an array of non-empty strings');
  }
  if (value.promptDigest !== undefined && !isSha256(value.promptDigest)) {
    errors.push('promptDigest must be a sha256 hex digest when provided');
  }
  errors.push(...validateIsoField(value, 'createdAt'));
  errors.push(...validateIsoField(value, 'updatedAt'));

  if (!Array.isArray(value.events)) {
    errors.push('events must be an array');
  } else {
    errors.push(...validateTaskEventSequence(value.events, value.taskId));
  }

  if (requiresWorkspaceLease(value as Partial<TaskEnvelope>) && !isNonEmptyString(value.workspaceLeaseId)) {
    errors.push('workspaceLeaseId is required for writable or protected actions after preparation');
  }
  return errors;
}

export function validateTaskEvent(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['TaskEvent must be an object'];
  if (value.kind !== 'TaskEvent') errors.push('kind must be TaskEvent');
  if (value.version !== 1) errors.push('version must be 1');
  requireString(value, 'id', errors);
  if (typeof value.seq !== 'number' || !Number.isInteger(value.seq) || value.seq < 1) {
    errors.push('seq must be a positive integer');
  }
  requireString(value, 'taskId', errors);
  if (!taskEventTypes.has(value.eventType as TaskEventType)) errors.push('eventType must be a supported task event type');
  if (!taskActors.has(String(value.actor))) errors.push('actor must be a supported task actor');
  if (value.state !== undefined && !taskStates.has(value.state as TaskState)) errors.push('state must be a supported task state');
  if (!isRecord(value.data)) errors.push('data must be a JSON object');
  errors.push(...validateIsoField(value, 'occurredAt'));
  errors.push(...validateEvidenceArray(value.evidence, 'evidence'));
  return errors;
}

export function validateWorkspaceLease(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['WorkspaceLease must be an object'];
  if (value.kind !== 'WorkspaceLease') errors.push('kind must be WorkspaceLease');
  if (value.version !== 1) errors.push('version must be 1');
  for (const field of ['leaseId', 'taskId', 'projectId', 'repositoryId', 'repositoryPath', 'baseRef', 'branch', 'path']) {
    requireString(value, field, errors);
  }
  if (!leaseStates.has(value.state as WorkspaceLeaseState)) errors.push('state must be a supported lease state');
  if (!dirtyPolicies.has(value.dirtyPolicy as WorkspaceLeaseDirtyPolicy)) {
    errors.push('dirtyPolicy must be retain_dirty or delete_when_clean');
  }
  errors.push(...validateIsoField(value, 'createdAt'));
  errors.push(...validateIsoField(value, 'updatedAt'));
  errors.push(...validateEvidenceArray(value.evidence, 'evidence'));

  if (value.owner !== undefined) errors.push(...validateLeaseOwner(value.owner));
  if ((value.state === 'claimed' || value.state === 'active') && value.owner === undefined) {
    errors.push('claimed and active leases require an owner');
  }
  if (value.state === 'active' && isRecord(value.owner) && value.owner.role !== 'writer') {
    errors.push('active writable leases require a writer owner');
  }
  if (value.heartbeat !== undefined) errors.push(...validateLeaseHeartbeat(value.heartbeat));
  if (value.state === 'dirty_retained' && value.dirtyPolicy !== 'retain_dirty') {
    errors.push('dirty_retained leases must use retain_dirty policy');
  }
  return errors;
}

export function validateProviderProfile(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['ProviderProfile must be an object'];
  if (value.kind !== 'ProviderProfile') errors.push('kind must be ProviderProfile');
  if (value.version !== 1) errors.push('version must be 1');
  requireString(value, 'id', errors);
  requireString(value, 'displayName', errors);
  if (!providerModes.has(value.mode as ProviderMode)) errors.push('mode must be managed or client');
  if (!transports.has(value.transport as ProviderTransport)) errors.push('transport must be supported');
  if (!supportLevels.has(value.supportLevel as ProviderSupportLevel)) errors.push('supportLevel must be supported');
  errors.push(...validateActionArray(value.supportedActions, 'supportedActions'));
  if (typeof value.writable !== 'boolean') errors.push('writable must be boolean');
  if (!isRecord(value.sandbox)) {
    errors.push('sandbox must be an object');
  } else {
    if (!sandboxProfiles.has(value.sandbox.profile as ProviderSandboxProfile)) {
      errors.push('sandbox.profile must be supported');
    }
    if (!Array.isArray(value.sandbox.assumptions) || !value.sandbox.assumptions.every(isNonEmptyString)) {
      errors.push('sandbox.assumptions must be an array of non-empty strings');
    }
  }
  if (typeof value.timeoutMs !== 'number' || !Number.isInteger(value.timeoutMs) || value.timeoutMs <= 0) {
    errors.push('timeoutMs must be a positive integer');
  }
  if (!Array.isArray(value.requiredVerification) || !value.requiredVerification.every(isNonEmptyString)) {
    errors.push('requiredVerification must be an array of non-empty strings');
  }
  if (value.writable === true && isRecord(value.sandbox) && value.sandbox.profile === 'read-only') {
    errors.push('writable providers cannot use a read-only sandbox profile');
  }
  if (value.supportLevel === 'client_only' && value.mode !== 'client') {
    errors.push('client_only providers must use client mode');
  }
  if (value.mode === 'managed' && value.transport === 'client') {
    errors.push('managed providers cannot use client transport');
  }
  return errors;
}

export function validateProviderRunRequest(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['ProviderRunRequest must be an object'];
  requireString(value, 'taskId', errors);
  requireString(value, 'providerProfileId', errors);
  if (!providerModes.has(value.mode as ProviderMode)) errors.push('mode must be managed or client');
  requireString(value, 'prompt', errors);
  if (!isSha256(value.promptDigest)) errors.push('promptDigest must be a sha256 hex digest');
  errors.push(...validateActionArray(value.requestedActions, 'requestedActions'));
  if (value.metadata !== undefined && !isRecord(value.metadata)) errors.push('metadata must be an object when provided');
  return errors;
}

export function validateProviderRunResult(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['ProviderRunResult must be an object'];
  requireString(value, 'taskId', errors);
  requireString(value, 'providerProfileId', errors);
  if (value.status !== 'completed' && value.status !== 'failed' && value.status !== 'blocked') {
    errors.push('status must be completed, failed, or blocked');
  }
  errors.push(...validateIsoField(value, 'startedAt'));
  errors.push(...validateIsoField(value, 'finishedAt'));
  if (!Array.isArray(value.changedFiles) || !value.changedFiles.every(isNonEmptyString)) {
    errors.push('changedFiles must be an array of non-empty strings');
  }
  if (!Array.isArray(value.verificationCommands) || !value.verificationCommands.every(isNonEmptyString)) {
    errors.push('verificationCommands must be an array of non-empty strings');
  }
  if (!isRecord(value.output)) errors.push('output must be a JSON object');
  errors.push(...validateEvidenceArray(value.evidence, 'evidence'));
  if ((value.status === 'failed' || value.status === 'blocked') && !isNonEmptyString(value.reason)) {
    errors.push('failed or blocked provider results require reason');
  }
  return errors;
}

export function validatePromotionPlan(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['PromotionPlan must be an object'];
  if (value.kind !== 'PromotionPlan') errors.push('kind must be PromotionPlan');
  if (value.version !== 1) errors.push('version must be 1');
  for (const field of ['promotionId', 'taskId', 'sourceBranch', 'targetBranch']) {
    requireString(value, field, errors);
  }
  if (!mergeQueueStates.has(value.state as MergeQueueState)) errors.push('state must be a supported merge queue state');
  if (!Array.isArray(value.requiredGates) || !value.requiredGates.every(isNonEmptyString)) {
    errors.push('requiredGates must be an array of non-empty strings');
  }
  if (!Array.isArray(value.brokerDecisions)) {
    errors.push('brokerDecisions must be an array');
  } else {
    value.brokerDecisions.forEach((decision, index) => {
      errors.push(...validateBrokerDecision(decision).map((error) => `brokerDecisions[${index}]: ${error}`));
    });
  }
  if (!Array.isArray(value.conflicts)) {
    errors.push('conflicts must be an array');
  } else {
    value.conflicts.forEach((conflict, index) => {
      if (!isRecord(conflict)) {
        errors.push(`conflicts[${index}] must be an object`);
      } else {
        requireString(conflict, 'file', errors, `conflicts[${index}].`);
        requireString(conflict, 'reason', errors, `conflicts[${index}].`);
        errors.push(...validateEvidenceArray(conflict.evidence, `conflicts[${index}].evidence`));
      }
    });
  }
  errors.push(...validateEvidenceArray(value.evidence, 'evidence'));
  errors.push(...validateIsoField(value, 'createdAt'));
  errors.push(...validateIsoField(value, 'updatedAt'));
  if ((value.state === 'ready' || value.state === 'merged') && Array.isArray(value.conflicts) && value.conflicts.length > 0) {
    errors.push('ready or merged promotion plans cannot contain conflicts');
  }
  return errors;
}

export function assertValidTaskEnvelope(value: unknown): asserts value is TaskEnvelope {
  assertNoErrors('TaskEnvelope', validateTaskEnvelope(value));
}

export function assertValidWorkspaceLease(value: unknown): asserts value is WorkspaceLease {
  assertNoErrors('WorkspaceLease', validateWorkspaceLease(value));
}

export function assertValidProviderProfile(value: unknown): asserts value is ProviderProfile {
  assertNoErrors('ProviderProfile', validateProviderProfile(value));
}

export function assertValidPromotionPlan(value: unknown): asserts value is PromotionPlan {
  assertNoErrors('PromotionPlan', validatePromotionPlan(value));
}

function validateTaskEventSequence(events: unknown[], expectedTaskId: unknown): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  let previousTime = Number.NEGATIVE_INFINITY;

  events.forEach((event, index) => {
    errors.push(...validateTaskEvent(event).map((error) => `events[${index}]: ${error}`));
    if (!isRecord(event)) return;
    if (event.taskId !== expectedTaskId) errors.push(`events[${index}]: taskId must match envelope taskId`);
    if (event.seq !== index + 1) errors.push(`events[${index}]: seq must be ${index + 1}`);
    if (typeof event.id === 'string') {
      if (ids.has(event.id)) errors.push(`events[${index}]: duplicate id ${event.id}`);
      ids.add(event.id);
    }
    const timestamp = typeof event.occurredAt === 'string' ? Date.parse(event.occurredAt) : Number.NaN;
    if (Number.isFinite(timestamp) && timestamp < previousTime) {
      errors.push(`events[${index}]: occurredAt is earlier than the previous event`);
    }
    if (Number.isFinite(timestamp)) previousTime = timestamp;
  });

  return errors;
}

function validateLeaseOwner(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['owner must be an object'];
  requireString(value, 'id', errors, 'owner.');
  if (!leaseOwnerRoles.has(value.role as WorkspaceLeaseOwnerRole)) errors.push('owner.role must be writer or reader');
  errors.push(...validateIsoField(value, 'claimedAt', 'owner.'));
  return errors;
}

function validateLeaseHeartbeat(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['heartbeat must be an object'];
  if (typeof value.intervalMs !== 'number' || !Number.isInteger(value.intervalMs) || value.intervalMs <= 0) {
    errors.push('heartbeat.intervalMs must be a positive integer');
  }
  errors.push(...validateIsoField(value, 'lastSeenAt', 'heartbeat.'));
  errors.push(...validateIsoField(value, 'expiresAt', 'heartbeat.'));
  if (typeof value.lastSeenAt === 'string' && typeof value.expiresAt === 'string') {
    const lastSeen = Date.parse(value.lastSeenAt);
    const expires = Date.parse(value.expiresAt);
    if (Number.isFinite(lastSeen) && Number.isFinite(expires) && expires <= lastSeen) {
      errors.push('heartbeat.expiresAt must be later than lastSeenAt');
    }
  }
  return errors;
}

function validateBrokerDecision(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['BrokerDecision must be an object'];
  if (!repositoryActions.has(value.action as RepositoryAction)) errors.push('action must be supported');
  if (!brokerStatuses.has(value.status as BrokerDecisionStatus)) errors.push('status must be supported');
  if (!Array.isArray(value.reasons) || !value.reasons.every(isNonEmptyString)) {
    errors.push('reasons must be an array of non-empty strings');
  }
  errors.push(...validateEvidenceArray(value.evidence, 'evidence'));
  errors.push(...validateIsoField(value, 'decidedAt'));
  return errors;
}

function validateActionArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) return [`${field} must be a non-empty array`];
  return value
    .map((item, index) => repositoryActions.has(item as RepositoryAction) ? '' : `${field}[${index}] must be supported`)
    .filter(Boolean);
}

function validateEvidenceArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) return [`${field} must be an array`];
  return value.flatMap((item, index) => validateEvidence(item).map((error) => `${field}[${index}]: ${error}`));
}

function validateEvidence(value: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(value)) return ['evidence must be an object'];
  if (!evidenceTypes.has(value.type as HarnessEvidenceType)) errors.push('type must be a supported evidence type');
  requireString(value, 'value', errors);
  return errors;
}

function validateIsoField(value: JsonRecord, field: string, prefix = ''): string[] {
  const candidate = value[field];
  if (typeof candidate !== 'string' || !Number.isFinite(Date.parse(candidate))) {
    return [`${prefix}${field} must be an ISO timestamp`];
  }
  return [];
}

function requireString(value: JsonRecord, field: string, errors: string[], prefix = ''): void {
  if (!isNonEmptyString(value[field])) errors.push(`${prefix}${field} must be a non-empty string`);
}

function requiresWorkspaceLease(value: Partial<TaskEnvelope>): boolean {
  if (!value.state || value.state === 'created' || value.state === 'prepared' || value.state === 'blocked' || value.state === 'failed') {
    return false;
  }
  return (value.requestedActions ?? []).some((action) => action !== 'read');
}

function assertNoErrors(name: string, errors: string[]): void {
  if (errors.length > 0) throw new Error(`Invalid ${name}: ${errors.join('; ')}`);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
