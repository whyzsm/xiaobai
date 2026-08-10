import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathExists, readText } from '../../shared/src/fs';
import { resolveMemoryPath } from '../../shared/src/memoryRoot';
import {
  GateCheckInput,
  GateDecision,
  GateGrantInput,
  GatePassEvent,
  HarnessEvidenceType,
  HumanGateDefinition,
  HumanGatePlan,
  LegacyGatePassEvent,
  LoopSpec,
  StoredGatePassEvent
} from '../../shared/src/types';
import { createGatePolicyDigest, createGateSubject, gateCanonicalization } from './subjectDigest';

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

export class HumanGate {
  constructor(private readonly loop: LoopSpec) {}

  plan(): HumanGatePlan {
    return {
      protectedActions: this.loop.humanGate.requiredBefore,
      reviewers: this.loop.humanGate.reviewers,
      gates: this.loop.humanGate.gates
    };
  }

  grant(input: GateGrantInput): GatePassEvent {
    const gate = this.requireGate(input.gateId);
    this.requireReviewer(gate, input.issuer);
    requireNonEmpty(input.runId, 'runId');
    requireNonEmpty(input.taskId, 'taskId');
    if (input.stageId !== undefined) {
      requireNonEmpty(input.stageId, 'stageId');
      const stage = this.loop.workflow?.stages.find((item) => item.id === input.stageId);
      if (!stage) {
        throw new Error(`Unknown workflow stage: ${input.stageId}`);
      }
      if (!(stage.requiredGates ?? []).includes(gate.id)) {
        throw new Error(`Gate ${gate.id} is not required by workflow stage ${input.stageId}`);
      }
    }

    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    const providedTypes = new Set(evidence.map((item) => item.type));
    for (const evidenceType of gate.requiredEvidenceTypes) {
      if (!providedTypes.has(evidenceType)) {
        throw new Error(`Gate ${gate.id} requires evidence type: ${evidenceType}`);
      }
    }
    for (const [index, item] of evidence.entries()) {
      if (!evidenceTypes.has(item.type) || !item.value.trim()) {
        throw new Error(`Gate evidence ${index} must use a supported type and non-empty value`);
      }
    }

    const now = input.now ?? new Date();
    const issuedAt = now.toISOString();
    const subject = createGateSubject(gate, input.subject);
    const policyDigest = createGatePolicyDigest(gate, resolveReviewers(this.loop, gate));
    return {
      kind: 'GatePass',
      version: 2,
      id: randomUUID(),
      passId: randomUUID(),
      loopId: this.loop.metadata.id,
      runId: input.runId,
      taskId: input.taskId,
      stageId: input.stageId,
      gateId: gate.id,
      action: gate.requiredBefore,
      status: 'granted',
      issuer: input.issuer,
      canonicalization: subject.canonicalization,
      subjectDigest: subject.subjectDigest,
      policyDigest,
      evidence,
      issuedAt,
      expiresAt: new Date(now.getTime() + gate.maxAgeMinutes * 60_000).toISOString()
    };
  }

  revoke(pass: GatePassEvent, issuer: string, reason: string, now = new Date()): GatePassEvent {
    if (pass.loopId !== this.loop.metadata.id || pass.status !== 'granted') {
      throw new Error(`Gate pass is not an active grant for loop ${this.loop.metadata.id}: ${pass.passId}`);
    }
    const gate = this.requireGate(pass.gateId);
    this.requireReviewer(gate, issuer);
    requireNonEmpty(reason, 'reason');

    return {
      kind: 'GatePass',
      version: 2,
      id: randomUUID(),
      passId: pass.passId,
      loopId: pass.loopId,
      runId: pass.runId,
      taskId: pass.taskId,
      stageId: pass.stageId,
      gateId: pass.gateId,
      action: pass.action,
      status: 'revoked',
      issuer,
      canonicalization: pass.canonicalization,
      subjectDigest: pass.subjectDigest,
      policyDigest: pass.policyDigest,
      evidence: [],
      issuedAt: now.toISOString(),
      reason
    };
  }

  check(input: GateCheckInput, events: StoredGatePassEvent[]): GateDecision {
    const blockingReasons: string[] = [];
    try {
      requireNonEmpty(input.runId, 'runId');
      requireNonEmpty(input.taskId, 'taskId');
    } catch (error) {
      blockingReasons.push(error instanceof Error ? error.message : String(error));
    }

    const requirements = this.requiredGateIds(input, blockingReasons);
    const requiredGates = requirements.ids;
    const satisfiedGates: string[] = [];
    const passes: GatePassEvent[] = [];
    const now = input.now ?? new Date();
    const validEvents = events.filter(isStoredGatePassEvent);
    if (validEvents.length !== events.length) {
      blockingReasons.push(`GatePass event log contains ${events.length - validEvents.length} invalid event(s)`);
    }
    const latestEvents = latestPassEvents(validEvents);

    for (const gateId of requiredGates) {
      const gate = this.requireGate(gateId);
      const authorizedReviewers = resolveReviewers(this.loop, gate);
      let subjectDigest: string;
      let policyDigest: string;
      try {
        subjectDigest = createGateSubject(gate, input.subject).subjectDigest;
        policyDigest = createGatePolicyDigest(gate, authorizedReviewers);
      } catch (error) {
        blockingReasons.push(error instanceof Error ? error.message : String(error));
        continue;
      }
      const gateCandidates = latestEvents.filter(
        (event) =>
          event.loopId === this.loop.metadata.id &&
          event.runId === input.runId &&
          event.taskId === input.taskId &&
          event.gateId === gateId
      );
      const candidates = requirements.stageGateIds.has(gateId)
        ? gateCandidates.filter((event) => event.stageId === input.stageId)
        : gateCandidates.filter((event) => event.stageId === undefined);
      const currentCandidates = candidates.filter(isGatePassEvent);
      const legacyCandidates = candidates.filter(isLegacyGatePassEvent);
      const granted = currentCandidates.find(
        (event) =>
          event.status === 'granted' &&
          event.action === gate.requiredBefore &&
          authorizedReviewers.includes(event.issuer) &&
          event.canonicalization === gateCanonicalization &&
          event.subjectDigest === subjectDigest &&
          event.policyDigest === policyDigest &&
          gate.requiredEvidenceTypes.every((type) => event.evidence.some((item) => item.type === type)) &&
          Date.parse(event.issuedAt) <= now.getTime() &&
          Boolean(event.expiresAt) &&
          Date.parse(event.expiresAt ?? '') > now.getTime()
      );

      if (granted) {
        satisfiedGates.push(gateId);
        passes.push(granted);
        continue;
      }
      if (requirements.stageGateIds.has(gateId) && gateCandidates.length > 0 && candidates.length === 0) {
        blockingReasons.push(`Gate ${gateId} has no pass for workflow stage ${input.stageId}`);
      } else if (currentCandidates.some((event) => event.status === 'revoked')) {
        blockingReasons.push(`Gate ${gateId} is revoked`);
      } else if (currentCandidates.some((event) => event.status === 'granted' && event.policyDigest !== policyDigest)) {
        blockingReasons.push(`Gate ${gateId} policy changed`);
      } else if (currentCandidates.some((event) => event.status === 'granted' && event.subjectDigest !== subjectDigest)) {
        blockingReasons.push(`Gate ${gateId} subject changed`);
      } else if (currentCandidates.some((event) => event.status === 'granted' && event.action !== gate.requiredBefore)) {
        blockingReasons.push(`Gate ${gateId} protected action changed`);
      } else if (
        currentCandidates.some(
          (event) => event.status === 'granted' && event.expiresAt && Date.parse(event.expiresAt) <= now.getTime()
        )
      ) {
        blockingReasons.push(`Gate ${gateId} is expired`);
      } else if (
        currentCandidates.some((event) => event.status === 'granted' && Date.parse(event.issuedAt) > now.getTime())
      ) {
        blockingReasons.push(`Gate ${gateId} was issued in the future`);
      } else if (
        currentCandidates.some((event) => event.status === 'granted' && !authorizedReviewers.includes(event.issuer))
      ) {
        blockingReasons.push(`Gate ${gateId} issuer is no longer authorized`);
      } else if (
        currentCandidates.some(
          (event) =>
            event.status === 'granted' &&
            !gate.requiredEvidenceTypes.every((type) => event.evidence.some((item) => item.type === type))
        )
      ) {
        blockingReasons.push(`Gate ${gateId} no longer satisfies its evidence policy`);
      } else if (legacyCandidates.length > 0) {
        blockingReasons.push(`Gate ${gateId} only has legacy passes that cannot authorize execution`);
      } else {
        blockingReasons.push(`Gate ${gateId} has no active pass`);
      }
    }

    return {
      status: blockingReasons.length === 0 ? 'passed' : 'blocked',
      requiredGates,
      satisfiedGates,
      blockingReasons,
      passes
    };
  }

  private requiredGateIds(
    input: GateCheckInput,
    errors: string[]
  ): { ids: string[]; stageGateIds: Set<string> } {
    const required = new Set<string>();
    const stageGateIds = new Set<string>();
    if (input.stageId) {
      const stage = this.loop.workflow?.stages.find((item) => item.id === input.stageId);
      if (!stage) {
        errors.push(`Unknown workflow stage: ${input.stageId}`);
      } else {
        for (const gateId of stage.requiredGates ?? []) {
          required.add(gateId);
          stageGateIds.add(gateId);
        }
      }
    }
    const actions = Array.isArray(input.actions) ? input.actions : [];
    if (actions.some((action) => typeof action !== 'string' || action.trim().length === 0)) {
      errors.push('Gate check actions must be non-empty strings');
    }
    for (const action of actions) {
      const actionGates = this.loop.humanGate.gates.filter((gate) => gate.requiredBefore === action);
      if (actionGates.length === 0) {
        errors.push(`Action is not protected by a gate: ${action}`);
      }
      for (const gate of actionGates) required.add(gate.id);
    }
    if (!input.stageId && actions.length === 0) {
      errors.push('Gate check requires stageId or at least one action');
    }
    return { ids: [...required], stageGateIds };
  }

  private requireGate(gateId: string): HumanGateDefinition {
    const gate = this.loop.humanGate.gates.find((item) => item.id === gateId);
    if (!gate) throw new Error(`Unknown human gate: ${gateId}`);
    return gate;
  }

  private requireReviewer(gate: HumanGateDefinition, issuer: string): void {
    requireNonEmpty(issuer, 'issuer');
    const reviewers = resolveReviewers(this.loop, gate);
    if (!reviewers.includes(issuer)) {
      throw new Error(`Issuer ${issuer} is not authorized for gate ${gate.id}`);
    }
  }
}

export class GatePassStore {
  constructor(
    private readonly memoryRoot: string,
    private readonly loopId: string
  ) {}

  filePath(): string {
    return resolveMemoryPath(this.memoryRoot, `memory/loops/${this.loopId}/passes.jsonl`);
  }

  async readAll(): Promise<StoredGatePassEvent[]> {
    const filePath = this.filePath();
    if (!(await pathExists(filePath))) return [];
    const lines = (await readText(filePath)).split(/\r?\n/).filter((line) => line.trim().length > 0);
    return lines.map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Invalid GatePass JSONL at ${filePath}:${index + 1}`);
      }
      if (!isStoredGatePassEvent(value)) {
        throw new Error(`Invalid GatePass event at ${filePath}:${index + 1}`);
      }
      return value;
    });
  }

  async append(event: GatePassEvent): Promise<void> {
    if (event.loopId !== this.loopId || !isGatePassEvent(event)) {
      throw new Error(`Cannot append invalid GatePass event for loop ${this.loopId}`);
    }
    const filePath = this.filePath();
    await mkdir(path.dirname(filePath), { recursive: true });
    await appendFile(filePath, `${JSON.stringify(event)}\n`, 'utf8');
  }

  async current(passId: string): Promise<StoredGatePassEvent | undefined> {
    const events = await this.readAll();
    return [...events].reverse().find((event) => event.passId === passId);
  }
}

function latestPassEvents(events: StoredGatePassEvent[]): StoredGatePassEvent[] {
  const latest = new Map<string, StoredGatePassEvent>();
  for (const event of events) latest.set(event.passId, event);
  return [...latest.values()];
}

function requireNonEmpty(value: string, field: string): void {
  if (!value || !value.trim()) throw new Error(`${field} must be a non-empty string`);
}

function isGatePassEvent(value: unknown): value is GatePassEvent {
  if (!isRecord(value)) return false;
  return (
    value.version === 2 &&
    value.canonicalization === gateCanonicalization &&
    isDigest(value.policyDigest) &&
    hasValidGatePassFields(value)
  );
}

function isLegacyGatePassEvent(value: unknown): value is LegacyGatePassEvent {
  return isRecord(value) && value.version === 1 && hasValidGatePassFields(value);
}

function isStoredGatePassEvent(value: unknown): value is StoredGatePassEvent {
  return isGatePassEvent(value) || isLegacyGatePassEvent(value);
}

function hasValidGatePassFields(value: Record<string, unknown>): boolean {
  if (
    value.kind !== 'GatePass' ||
    !isNonEmptyString(value.id) ||
    !isNonEmptyString(value.passId) ||
    !isNonEmptyString(value.loopId) ||
    !isNonEmptyString(value.runId) ||
    !isNonEmptyString(value.taskId) ||
    (value.stageId !== undefined && !isNonEmptyString(value.stageId)) ||
    !isNonEmptyString(value.gateId) ||
    !isNonEmptyString(value.action) ||
    (value.status !== 'granted' && value.status !== 'revoked') ||
    !isNonEmptyString(value.issuer) ||
    !isDigest(value.subjectDigest) ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isGatePassEvidence) ||
    !isIsoTimestamp(value.issuedAt)
  ) {
    return false;
  }

  const evidence = value.evidence;
  const issuedAt = value.issuedAt;
  if (value.status === 'granted') {
    const expiresAt = value.expiresAt;
    return (
      evidence.length > 0 &&
      isIsoTimestamp(expiresAt) &&
      Date.parse(expiresAt) > Date.parse(issuedAt) &&
      value.reason === undefined
    );
  }
  return evidence.length === 0 && value.expiresAt === undefined && isNonEmptyString(value.reason);
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isGatePassEvidence(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.type === 'string' &&
    evidenceTypes.has(value.type as HarnessEvidenceType) &&
    isNonEmptyString(value.value)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function resolveReviewers(loop: LoopSpec, gate: HumanGateDefinition): string[] {
  return gate.reviewers.map((reviewer) => reviewer === 'owner' ? loop.metadata.owner : reviewer);
}
