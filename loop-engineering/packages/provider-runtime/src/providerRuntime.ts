import path from 'node:path';
import {
  ExecutorAdapter,
  ExecutorReportedEvent,
  GatePassEvidence,
  JsonRecord,
  ProviderProfile,
  ProviderRunResult,
  RepositoryAction,
  WorkspaceLease
} from '../../shared/src/types';
import {
  assertValidProviderProfile,
  validateProviderRunResult,
  validateProviderProfile
} from '../../shared/src/portableExecutionContracts';

export const codexReadOnlyProfileId = 'codex-cli-read-only';
export const codexWritableProfileId = 'codex-cli-writable';
export const claudeManagedProfileId = 'claude-code-managed';
export const geminiManagedProfileId = 'gemini-cli-managed';
export const clientSubmissionProfileId = 'client-submission';
export const zcodeClientProfileId = 'zcode-client';
export const workbuddyClientProfileId = 'workbuddy-client';

export interface ProviderSelectionInput {
  profileId?: string;
  requestedActions: RepositoryAction[];
}

export interface ProviderAdapterFactoryInput {
  profileId?: string;
  requestedActions: RepositoryAction[];
  factories: Record<string, (profile: ProviderProfile) => ExecutorAdapter>;
}

export interface ProviderAdapterSelection {
  profile: ProviderProfile;
  adapter: ExecutorAdapter;
}

export interface ProviderRuntimeEventInput {
  eventType: ExecutorReportedEvent['eventType'];
  providerProfileId: string;
  taskId: string;
  data?: JsonRecord;
  evidence?: GatePassEvidence[];
}

export interface ProviderWorkspaceGuardInput {
  profile: ProviderProfile;
  requestedActions: RepositoryAction[];
  workspaceLease?: WorkspaceLease;
  cwd?: string;
}

export interface ProviderResultParseInput {
  taskId: string;
  providerProfileId: string;
  status: ProviderRunResult['status'];
  startedAt: string;
  finishedAt: string;
  output: JsonRecord;
  evidence?: GatePassEvidence[];
  reason?: string;
}

export class ProviderRuntime {
  private readonly profiles: Map<string, ProviderProfile>;

  constructor(profiles: ProviderProfile[] = defaultProviderProfiles()) {
    this.profiles = new Map();
    for (const profile of profiles) {
      assertValidProviderProfile(profile);
      if (this.profiles.has(profile.id)) throw new Error(`Duplicate provider profile: ${profile.id}`);
      this.profiles.set(profile.id, profile);
    }
  }

  listProfiles(): ProviderProfile[] {
    return [...this.profiles.values()].map((profile) => ({
      ...profile,
      supportedActions: [...profile.supportedActions],
      args: profile.args ? [...profile.args] : undefined,
      sandbox: {
        ...profile.sandbox,
        assumptions: [...profile.sandbox.assumptions]
      },
      requiredVerification: [...profile.requiredVerification]
    }));
  }

  requireProfile(profileId: string): ProviderProfile {
    const profile = this.profiles.get(profileId);
    if (!profile) throw new Error(`Unknown provider profile: ${profileId}`);
    return profile;
  }

  selectProfile(input: ProviderSelectionInput): ProviderProfile {
    const profile = input.profileId
      ? this.requireProfile(input.profileId)
      : this.requireProfile(codexReadOnlyProfileId);
    const errors = validateProviderCanHandle(profile, input.requestedActions);
    if (errors.length > 0) throw new Error(`Provider capability mismatch: ${errors.join('; ')}`);
    return profile;
  }

  createExecutorAdapter(input: ProviderAdapterFactoryInput): ProviderAdapterSelection {
    const profile = this.selectProfile(input);
    const factory = input.factories[profile.id];
    if (!factory) throw new Error(`No executor adapter factory registered for provider profile: ${profile.id}`);
    return { profile, adapter: factory(profile) };
  }
}

export function defaultProviderProfiles(): ProviderProfile[] {
  return [
    {
      kind: 'ProviderProfile',
      version: 1,
      id: codexReadOnlyProfileId,
      displayName: 'Codex CLI Read Only',
      mode: 'managed',
      transport: 'cli',
      supportLevel: 'supported',
      executable: 'codex',
      supportedActions: ['read'],
      writable: false,
      sandbox: {
        profile: 'read-only',
        assumptions: ['Codex CLI is launched with --sandbox read-only and explicit --cd.']
      },
      timeoutMs: 900000,
      requiredVerification: ['harness', 'evaluator']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: codexWritableProfileId,
      displayName: 'Codex CLI Writable',
      mode: 'managed',
      transport: 'cli',
      supportLevel: 'experimental',
      executable: 'codex',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'workspace-write',
        assumptions: ['Codex CLI is launched with --sandbox workspace-write and a lease-scoped --cd.']
      },
      timeoutMs: 900000,
      requiredVerification: ['harness', 'evaluator', 'diff']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: claudeManagedProfileId,
      displayName: 'Claude Code Managed',
      mode: 'managed',
      transport: 'cli',
      supportLevel: 'experimental',
      executable: 'claude',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'workspace-write',
        assumptions: ['Claude Code managed execution requires a lease-scoped cwd and local smoke certification.']
      },
      timeoutMs: 900000,
      requiredVerification: ['harness', 'evaluator', 'diff']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: geminiManagedProfileId,
      displayName: 'Gemini CLI Managed',
      mode: 'managed',
      transport: 'cli',
      supportLevel: 'experimental',
      executable: 'gemini',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'workspace-write',
        assumptions: ['Gemini managed execution requires a lease-scoped cwd and local smoke certification.']
      },
      timeoutMs: 900000,
      requiredVerification: ['harness', 'evaluator', 'diff']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: clientSubmissionProfileId,
      displayName: 'External Client Submission',
      mode: 'client',
      transport: 'client',
      supportLevel: 'client_only',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'external',
        assumptions: ['Host sandbox is outside Xiaobai; every submission is treated as untrusted input.']
      },
      timeoutMs: 1,
      requiredVerification: ['harness', 'evaluator', 'diff', 'policy']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: zcodeClientProfileId,
      displayName: 'ZCode Client',
      mode: 'client',
      transport: 'client',
      supportLevel: 'client_only',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'external',
        assumptions: ['ZCode managed execution is not certified; use client submission until smoke tests pass.']
      },
      timeoutMs: 1,
      requiredVerification: ['harness', 'evaluator', 'diff', 'policy']
    },
    {
      kind: 'ProviderProfile',
      version: 1,
      id: workbuddyClientProfileId,
      displayName: 'WorkBuddy Client',
      mode: 'client',
      transport: 'client',
      supportLevel: 'client_only',
      supportedActions: ['read', 'write'],
      writable: true,
      sandbox: {
        profile: 'external',
        assumptions: ['WorkBuddy managed execution is not certified; use client submission until smoke tests pass.']
      },
      timeoutMs: 1,
      requiredVerification: ['harness', 'evaluator', 'diff', 'policy']
    }
  ];
}

export function validateProviderCanHandle(profile: ProviderProfile, requestedActions: RepositoryAction[]): string[] {
  const profileErrors = validateProviderProfile(profile);
  if (profileErrors.length > 0) return profileErrors;
  const supported = new Set(profile.supportedActions);
  const errors: string[] = [];
  for (const action of requestedActions) {
    if (!supported.has(action)) errors.push(`${profile.id} does not support ${action}`);
  }
  if (requestedActions.some((action) => action !== 'read') && !profile.writable) {
    errors.push(`${profile.id} is registered as read-only`);
  }
  return errors;
}

export function normalizeProviderRuntimeEvent(input: ProviderRuntimeEventInput): ExecutorReportedEvent {
  return {
    eventType: input.eventType,
    data: {
      providerProfileId: input.providerProfileId,
      taskId: input.taskId,
      ...(input.data ?? {})
    },
    evidence: input.evidence ?? []
  };
}

export function validateProviderWorkspaceGuard(input: ProviderWorkspaceGuardInput): string[] {
  const errors = validateProviderCanHandle(input.profile, input.requestedActions);
  const requiresWriteBoundary = input.requestedActions.some((action) => action !== 'read');
  if (!requiresWriteBoundary) return errors;
  if (!input.workspaceLease) {
    errors.push('writable provider execution requires a workspace lease');
    return errors;
  }
  if (input.workspaceLease.state !== 'claimed' && input.workspaceLease.state !== 'active') {
    errors.push(`workspace lease must be claimed or active, received ${input.workspaceLease.state}`);
  }
  if (input.workspaceLease.owner?.role !== 'writer') {
    errors.push('workspace lease requires a writer owner');
  }
  if (!input.cwd) {
    errors.push('writable provider execution requires cwd');
  } else if (!containsPath(input.workspaceLease.path, input.cwd)) {
    errors.push('writable provider cwd must stay inside the workspace lease path');
  }
  return errors;
}

export function parseProviderRunResult(input: ProviderResultParseInput): ProviderRunResult {
  const result: ProviderRunResult = {
    taskId: input.taskId,
    providerProfileId: input.providerProfileId,
    status: input.status,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    changedFiles: stringArray(input.output.changedFiles),
    diffSummary: stringValue(input.output.diffSummary),
    verificationCommands: stringArray(input.output.verificationCommands),
    output: input.output,
    evidence: input.evidence ?? [],
    reason: input.reason
  };
  const errors = validateProviderRunResult(result);
  if (errors.length > 0) throw new Error(`Invalid ProviderRunResult: ${errors.join('; ')}`);
  return result;
}

function containsPath(root: string, candidate: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
