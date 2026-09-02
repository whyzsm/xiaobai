import { CONFIG_CONTRACT_VERSION, CONTRACT_VERSION, ERROR_CODES, ID_PATTERNS, LIFECYCLE_STATES } from './constants.js'
import { cloneCanonical, sha256Digest } from './canonical.js'
import { contractError } from './errors.js'
import { validateRepositoryBinding } from './path-binding.js'
import { ProjectBaselineSchema, AgentProfileSchema, SkillPackageSchema, StageEvidenceSchema, EvaluatorResultSchema, GateDecisionSchema, RunLockSchema, KnowledgeBindingSchema, MemoryRecordSchema, MemoryCheckpointSchema, MemoryAuditSchema, MemoryProjectionSchema, MemoryConflictSchema, PolicyContextSchema, ProjectConfigDraftSchema, ProjectConfigPreviewSchema, ProjectConfigApplyResultSchema, ConfigHistoryEntrySchema, ResponseEnvelopeSchema } from './typed.js'
import { isAbsolute } from 'node:path'

const resourceId = (prefix) => ({ type: 'string', pattern: `^${prefix}_[a-z0-9][a-z0-9_-]{2,63}$` })
const nonBlank = { type: 'string', minLength: 1 }
const digest = { type: 'string', pattern: '^sha256:[a-f0-9]{64}$' }
const classification = { enum: ['public', 'internal', 'confidential', 'restricted'] }
const stringArray = { type: 'array', items: { type: 'string' } }
const knowledgeBinding = {
  type: 'object',
  required: ['knowledgeId', 'source', 'scope', 'revision', 'digest', 'readOnly', 'trust', 'requiredCapabilities'],
  properties: { knowledgeId: resourceId('know'), source: nonBlank, scope: nonBlank, revision: nonBlank, digest, readOnly: { type: 'boolean' }, trust: { enum: ['bundled', 'project', 'external', 'derived'] }, requiredCapabilities: stringArray },
  additionalProperties: false,
}
const agentProfile = {
  type: 'object',
  required: ['agentId', 'role', 'purpose', 'modelPolicyRef', 'allowedSkills', 'requiredContext', 'capabilities', 'riskLevel', 'humanGatePolicy', 'outputContract'],
  properties: { agentId: resourceId('agent'), role: nonBlank, purpose: nonBlank, modelPolicyRef: nonBlank, allowedSkills: stringArray, requiredContext: stringArray, capabilities: stringArray, riskLevel: { enum: ['low', 'medium', 'high', 'critical'] }, humanGatePolicy: nonBlank, outputContract: nonBlank },
  additionalProperties: false,
}
const skillPackage = {
  type: 'object',
  required: ['skillId', 'name', 'version', 'purpose', 'owner', 'invocation', 'requiredContext', 'capabilities', 'sideEffects', 'evidenceRequirements', 'trust'],
  properties: { skillId: resourceId('skill'), name: { type: 'string', pattern: ID_PATTERNS.key.source }, version: nonBlank, purpose: nonBlank, owner: nonBlank, invocation: { type: 'object', required: ['modelInvocable', 'userInvocable'], properties: { modelInvocable: { type: 'boolean' }, userInvocable: { type: 'boolean' } }, additionalProperties: false }, requiredContext: stringArray, capabilities: stringArray, sideEffects: stringArray, evidenceRequirements: stringArray, trust: { enum: ['bundled', 'project', 'external'] } },
  additionalProperties: false,
}
const worktree = {
  type: 'object',
  required: ['worktreeId', 'root', 'pathTemplate', 'readOnly', 'owner', 'classification'],
  properties: { worktreeId: resourceId('worktree'), root: nonBlank, pathTemplate: nonBlank, readOnly: { type: 'boolean' }, owner: nonBlank, classification },
  additionalProperties: false,
}
const repository = {
  type: 'object',
  required: ['repoId', 'name', 'root', 'pathTemplate', 'source', 'readOnly', 'owner', 'classification', 'worktrees'],
  properties: { repoId: resourceId('repo'), name: nonBlank, root: nonBlank, pathTemplate: nonBlank, source: { enum: ['local', 'remote', 'mount'] }, readOnly: { type: 'boolean' }, owner: nonBlank, classification, worktrees: { type: 'array', items: worktree } },
  additionalProperties: false,
}
const memory = { type: 'object', required: ['namespaceId', 'retention', 'projection'], properties: { namespaceId: resourceId('mem'), retention: nonBlank, projection: nonBlank }, additionalProperties: false }
const policyRefs = { type: 'object', required: ['agent', 'memory', 'workflow'], properties: { agent: nonBlank, memory: nonBlank, workflow: nonBlank, project: nonBlank }, additionalProperties: false }
const provenance = { type: 'object', required: ['source', 'revision', 'digest', 'scope', 'trust'], properties: { source: nonBlank, revision: nonBlank, digest, scope: nonBlank, trust: { enum: ['bundled', 'project', 'external', 'derived'] } }, additionalProperties: false }
const configLocator = { type: 'string', minLength: 1, pattern: '^(?!/)(?![A-Za-z]:[\\\\/])(?!\\\\)(?!//)(?![A-Za-z][A-Za-z0-9+.-]*:)(?!.*(?:^|[/\\\\])\\.\\.(?:[/\\\\]|$))(?!.*\\u0000).+$' }
const bindingRef = { type: 'string', pattern: '^[a-z][a-z0-9_-]{2,63}$' }
const configAgentProfile = {
  type: 'object',
  required: ['role', 'purpose', 'modelPolicyRef', 'allowedSkills', 'requiredContext', 'capabilities', 'riskLevel', 'humanGatePolicy', 'outputContract'],
  properties: { agentId: resourceId('agent'), role: nonBlank, purpose: nonBlank, modelPolicyRef: nonBlank, allowedSkills: stringArray, requiredContext: stringArray, capabilities: stringArray, riskLevel: { enum: ['low', 'medium', 'high', 'critical'] }, humanGatePolicy: nonBlank, outputContract: nonBlank },
  additionalProperties: false,
}
const configSkillPackage = {
  type: 'object',
  required: ['name', 'version', 'purpose', 'owner', 'capabilities', 'trust'],
  properties: { skillId: resourceId('skill'), name: { type: 'string', pattern: ID_PATTERNS.key.source }, version: nonBlank, purpose: nonBlank, owner: nonBlank, capabilities: stringArray, trust: { enum: ['bundled', 'project', 'external'] } },
  additionalProperties: false,
}
const configPayload = {
  type: 'object',
  required: ['key', 'displayName', 'owner', 'classification', 'repositories', 'knowledgeBindings', 'agentProfiles', 'skills', 'memory', 'artifact', 'qualityCommands'],
  properties: {
    key: { type: 'string', pattern: ID_PATTERNS.key.source }, displayName: nonBlank, owner: nonBlank, classification,
    repositories: { type: 'array', minItems: 1, items: { type: 'object', required: ['name', 'source', 'readOnly', 'classification'], properties: { repoId: resourceId('repo'), name: nonBlank, source: { enum: ['local', 'remote', 'mount'] }, bindingRef, locator: configLocator, readOnly: { type: 'boolean' }, classification }, additionalProperties: false } },
    knowledgeBindings: { type: 'array', minItems: 1, items: { type: 'object', required: ['source', 'scope', 'revision', 'digest', 'readOnly', 'trust'], properties: { knowledgeId: resourceId('know'), source: nonBlank, bindingRef, locator: configLocator, scope: nonBlank, revision: nonBlank, digest, readOnly: { type: 'boolean' }, trust: { enum: ['bundled', 'project', 'external', 'derived'] }, requiredCapabilities: stringArray }, additionalProperties: false } },
    agentProfiles: { type: 'array', minItems: 1, items: configAgentProfile }, skills: { type: 'array', items: configSkillPackage },
    memory: { type: 'object', required: ['namespaceId', 'retention', 'projection'], properties: { namespaceId: resourceId('mem'), retention: nonBlank, projection: nonBlank }, additionalProperties: false },
    artifact: { type: 'object', required: ['locator', 'readOnly'], properties: { bindingRef, locator: configLocator, readOnly: { type: 'boolean' } }, additionalProperties: false },
    qualityCommands: { type: 'object', required: ['validate', 'test'], properties: { validate: nonBlank, test: nonBlank }, additionalProperties: false },
  },
  additionalProperties: false,
}

export const JSON_SCHEMAS = Object.freeze({
  projectBaseline: {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: `${CONTRACT_VERSION}/project-baseline`,
    type: 'object',
    required: ['schemaVersion', 'projectId', 'key', 'displayName', 'owner', 'classification', 'repositories', 'knowledgeBindings', 'agentProfiles', 'skills', 'memory', 'artifactRoot', 'qualityCommands'],
    properties: {
      schemaVersion: { const: CONTRACT_VERSION }, projectId: resourceId('prj'), key: { type: 'string', pattern: ID_PATTERNS.key.source }, displayName: nonBlank, owner: nonBlank,
      classification, repositories: { type: 'array', minItems: 1, items: repository }, knowledgeBindings: { type: 'array', minItems: 1, items: knowledgeBinding }, agentProfiles: { type: 'array', minItems: 1, items: agentProfile }, skills: { type: 'array', items: skillPackage },
      memory, artifactRoot: nonBlank, qualityCommands: { type: 'object', required: ['validate', 'test'], properties: { validate: nonBlank, test: nonBlank }, additionalProperties: false }, policyRefs, lifecycle: { enum: LIFECYCLE_STATES },
    },
    additionalProperties: false,
  },
  knowledgeBinding,
  agentProfile,
  skillPackage,
  runLock: { type: 'object', required: ['schemaVersion', 'runId', 'host', 'workspaceId', 'projectId', 'scopeKey', 'knowledge', 'repositoryBindingDigest', 'agentPolicyDigest', 'skillRevision', 'workflowScriptDigest', 'policyDigest', 'memoryNamespaceId', 'artifactRoot', 'createdAt'], properties: { schemaVersion: { const: CONTRACT_VERSION }, runId: resourceId('run'), host: { type: 'object' }, workspaceId: resourceId('ws'), projectId: resourceId('prj'), scopeKey: nonBlank, knowledge: { type: 'array', minItems: 1, items: knowledgeBinding }, repositoryBindingDigest: digest, agentPolicyDigest: digest, skillRevision: nonBlank, workflowScriptDigest: digest, policyDigest: digest, memoryNamespaceId: resourceId('mem'), artifactRoot: nonBlank, createdAt: nonBlank }, additionalProperties: false },
    stageEvidence: { type: 'object', required: ['stageId', 'status', 'enteredAt', 'firstActionAt', 'exitedAt', 'durationMs', 'activeMs', 'waitingMs', 'waitingReason', 'evidence'], properties: { stageId: resourceId('stage'), status: { enum: ['active', 'blocked', 'completed', 'failed', 'unmeasured'] }, enteredAt: nonBlank, firstActionAt: nonBlank, exitedAt: nonBlank, durationMs: { type: 'integer', minimum: 0 }, activeMs: { type: 'integer', minimum: 0 }, waitingMs: { type: 'integer', minimum: 0 }, waitingReason: nonBlank, evidence: { type: 'array', minItems: 1, items: { type: 'string' } }, timingSource: { enum: ['host-session', 'plugin-clock', 'unmeasured'] }, waitingReasons: stringArray }, additionalProperties: false },
  evaluatorResult: { type: 'object', required: ['evaluatorId', 'status', 'contractVersion', 'findings', 'evidence'], properties: { evaluatorId: resourceId('agent'), status: { enum: ['passed', 'failed'] }, contractVersion: nonBlank, findings: { type: 'array', items: { type: 'object' } }, evidence: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  gateDecision: { type: 'object', required: ['gateId', 'outcome', 'actor', 'reason', 'timestamp', 'inputDigest', 'evidence', 'approval'], properties: { gateId: resourceId('gate'), outcome: { enum: ['allowed', 'rejected', 'unavailable', 'cancelled', 'rework'] }, actor: nonBlank, reason: nonBlank, timestamp: nonBlank, inputDigest: digest, evidence: { type: 'array', minItems: 1, items: { type: 'string' } }, approval: { type: 'object', required: ['outcome', 'auditRequired', 'asked', 'decided'], properties: { outcome: { enum: ['allowed-once', 'rejected', 'cancelled', 'unavailable'] }, auditRequired: { const: true }, asked: { const: true }, decided: { const: true }, requestId: nonBlank }, additionalProperties: false } }, additionalProperties: false },
    memoryRecord: { type: 'object', required: ['projectId', 'namespaceId', 'kind', 'body', 'sourceRef', 'createdAt', 'provenance', 'retention'], properties: { projectId: resourceId('prj'), namespaceId: resourceId('mem'), kind: { enum: ['state', 'inbox', 'decision', 'run', 'finding', 'metric'] }, body: { type: 'object' }, sourceRef: nonBlank, createdAt: nonBlank, provenance, retention: nonBlank, expiresAt: nonBlank }, additionalProperties: false },
    memoryCheckpoint: { type: 'object', required: ['checkpointId', 'projectId', 'namespaceId', 'inputDigest', 'auditDigest', 'sourceRef', 'createdAt', 'provenance'], properties: { checkpointId: nonBlank, projectId: resourceId('prj'), namespaceId: resourceId('mem'), inputDigest: digest, auditDigest: digest, sourceRef: nonBlank, createdAt: nonBlank, provenance }, additionalProperties: false },
    memoryAudit: { type: 'object', required: ['auditId', 'projectId', 'namespaceId', 'eventType', 'sourceEventRef', 'evidence', 'createdAt', 'provenance'], properties: { auditId: nonBlank, projectId: resourceId('prj'), namespaceId: resourceId('mem'), eventType: nonBlank, sourceEventRef: nonBlank, evidence: { type: 'array', minItems: 1, items: nonBlank }, createdAt: nonBlank, provenance }, additionalProperties: false },
    memoryProjection: { type: 'object', required: ['projectionId', 'projectId', 'namespaceId', 'target', 'path', 'contentDigest', 'sourceRecordIds', 'content', 'createdAt', 'provenance'], properties: { projectionId: nonBlank, projectId: resourceId('prj'), namespaceId: resourceId('mem'), target: { const: 'obsidian' }, path: nonBlank, contentDigest: digest, sourceRecordIds: { type: 'array', items: { type: 'string' } }, content: { type: 'string' }, createdAt: nonBlank, provenance }, additionalProperties: false },
    memoryConflict: { type: 'object', required: ['conflictId', 'projectId', 'namespaceId', 'recordKey', 'existingDigest', 'incomingDigest', 'createdAt', 'provenance'], properties: { conflictId: nonBlank, projectId: resourceId('prj'), namespaceId: resourceId('mem'), recordKey: nonBlank, existingDigest: digest, incomingDigest: digest, createdAt: nonBlank, provenance }, additionalProperties: false },
    policyContext: { type: 'object', required: ['kind', 'policyId', 'values', 'source', 'revision', 'digest', 'scope', 'trust', 'requiredCapabilities'], properties: { kind: { enum: ['agent', 'memory', 'workflow', 'project', 'agent-profile'] }, policyId: nonBlank, values: { type: 'object' }, source: nonBlank, revision: nonBlank, digest, scope: nonBlank, trust: { enum: ['bundled', 'project', 'external', 'derived'] }, requiredCapabilities: stringArray }, additionalProperties: false },
    projectConfigDraft: { type: 'object', required: ['schemaVersion', 'draftId', 'workspaceId', 'operation', 'baseRevision', 'baseDigest', 'actor', 'config', 'createdAt'], properties: { schemaVersion: { const: CONFIG_CONTRACT_VERSION }, draftId: resourceId('drf'), workspaceId: resourceId('ws'), projectId: resourceId('prj'), operation: { enum: ['create', 'update'] }, baseRevision: resourceId('rev'), baseDigest: digest, actor: { type: 'object', required: ['identity'], properties: { identity: nonBlank }, additionalProperties: false }, config: configPayload, createdAt: nonBlank }, additionalProperties: false },
    projectConfigPreview: { type: 'object', required: ['schemaVersion', 'previewId', 'draftId', 'workspaceId', 'projectId', 'baseRevision', 'baseDigest', 'currentRevision', 'currentDigest', 'status', 'files', 'risks', 'approvalRequired', 'nextAction', 'diagnostics'], properties: { schemaVersion: { const: CONFIG_CONTRACT_VERSION }, previewId: resourceId('ev'), draftId: resourceId('drf'), workspaceId: resourceId('ws'), projectId: resourceId('prj'), baseRevision: resourceId('rev'), baseDigest: digest, currentRevision: resourceId('rev'), currentDigest: digest, status: { enum: ['ready', 'invalid', 'drift', 'conflict'] }, files: { type: 'array' }, risks: { type: 'array' }, approvalRequired: { type: 'boolean' }, nextAction: nonBlank, diagnostics: { type: 'array' } }, additionalProperties: false },
    projectConfigApplyResult: { type: 'object', required: ['schemaVersion', 'applyId', 'workspaceId', 'projectId', 'revision', 'digest', 'status', 'evidenceRef', 'diagnostics'], properties: { schemaVersion: { const: CONFIG_CONTRACT_VERSION }, applyId: resourceId('ev'), workspaceId: resourceId('ws'), projectId: resourceId('prj'), revision: resourceId('rev'), digest, status: { enum: ['applied', 'conflict', 'approval_required', 'failed'] }, historyId: resourceId('ev'), evidenceRef: nonBlank, diagnostics: { type: 'array' } }, additionalProperties: false },
    configHistoryEntry: { type: 'object', required: ['schemaVersion', 'historyId', 'revision', 'workspaceId', 'projectId', 'parentRevision', 'digest', 'operation', 'actor', 'status', 'createdAt', 'evidenceRef', 'changedFiles', 'canRollback'], properties: { schemaVersion: { const: CONFIG_CONTRACT_VERSION }, historyId: resourceId('ev'), revision: resourceId('rev'), workspaceId: resourceId('ws'), projectId: resourceId('prj'), parentRevision: { anyOf: [resourceId('rev'), { type: 'null' }] }, digest, operation: { enum: ['create', 'update', 'rollback'] }, actor: nonBlank, status: { enum: ['applied', 'failed', 'rolled_back'] }, createdAt: nonBlank, evidenceRef: nonBlank, changedFiles: { type: 'array', items: configLocator }, canRollback: { type: 'boolean' } }, additionalProperties: false },
    responseEnvelope: { type: 'object', required: ['schemaVersion', 'requestId', 'status', 'diagnostics'], properties: { schemaVersion: { const: CONFIG_CONTRACT_VERSION }, requestId: resourceId('ev'), status: { enum: ['ok', 'invalid', 'drift', 'conflict', 'approval_required', 'failed', 'unsupported'] }, data: {}, diagnostics: { type: 'array' }, errorCode: nonBlank, phase: nonBlank, resourceId: nonBlank, evidenceRef: nonBlank }, additionalProperties: false },
  })

const requiredFields = Object.fromEntries(Object.entries(JSON_SCHEMAS).map(([name, schema]) => [name, schema.required]))
const TYPED_SCHEMAS = Object.freeze({ projectBaseline: ProjectBaselineSchema, knowledgeBinding: KnowledgeBindingSchema, agentProfile: AgentProfileSchema, skillPackage: SkillPackageSchema, runLock: RunLockSchema, stageEvidence: StageEvidenceSchema, evaluatorResult: EvaluatorResultSchema, gateDecision: GateDecisionSchema, memoryRecord: MemoryRecordSchema, memoryCheckpoint: MemoryCheckpointSchema, memoryAudit: MemoryAuditSchema, memoryProjection: MemoryProjectionSchema, memoryConflict: MemoryConflictSchema, policyContext: PolicyContextSchema, projectConfigDraft: ProjectConfigDraftSchema, projectConfigPreview: ProjectConfigPreviewSchema, projectConfigApplyResult: ProjectConfigApplyResultSchema, configHistoryEntry: ConfigHistoryEntrySchema, responseEnvelope: ResponseEnvelopeSchema })

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function checkId(value, field, expectedPrefix) {
  if (typeof value !== 'string' || !ID_PATTERNS.resource.test(value) || (expectedPrefix && !value.startsWith(`${expectedPrefix}_`))) throw contractError(`${field} must be an opaque resource id`, { phase: 'contract-validation', expected: `${expectedPrefix ?? 'resource'}_<opaque>`, actual: value })
}

function checkDigest(value, field) {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) throw contractError(`${field} must be a sha256 digest`, { phase: 'contract-validation', expected: 'sha256:<64 lowercase hex>', actual: value })
}

export function validateContract(name, value) {
  const schema = JSON_SCHEMAS[name]
  if (!schema || !isObject(value)) throw contractError(`Unknown or non-object contract '${name}'`, { phase: 'contract-validation', actual: value })
  for (const field of requiredFields[name]) if (value[field] === undefined) throw contractError(`Contract '${name}' is missing '${field}'`, { phase: 'contract-validation', expected: requiredFields[name], actual: Object.keys(value) })
  try { TYPED_SCHEMAS[name].parse(value) } catch (error) { throw contractError(`Contract '${name}' failed typed schema validation`, { phase: 'contract-validation', actual: error instanceof Error ? error.message : String(error), cause: error }) }
  if (name === 'projectBaseline') return validateProjectBaseline(value)
  if (name === 'knowledgeBinding') { checkId(value.knowledgeId, 'knowledgeId', 'know'); checkDigest(value.digest, 'digest'); if (typeof value.readOnly !== 'boolean') throw contractError('knowledgeBinding.readOnly must be boolean'); return cloneCanonical(value) }
  if (name === 'agentProfile') {
    checkId(value.agentId, 'agentId', 'agent')
    for (const field of ['role', 'purpose', 'modelPolicyRef', 'humanGatePolicy', 'outputContract']) if (typeof value[field] !== 'string' || value[field].length === 0) throw contractError(`agentProfile.${field} must be non-blank`)
    if (!Array.isArray(value.allowedSkills) || !Array.isArray(value.requiredContext) || !Array.isArray(value.capabilities)) throw contractError('agentProfile skill/context/capability fields must be arrays')
    if (!['low', 'medium', 'high', 'critical'].includes(value.riskLevel)) throw contractError('agentProfile.riskLevel is unsupported')
    return cloneCanonical(value)
  }
  if (name === 'skillPackage') { checkId(value.skillId, 'skillId', 'skill'); if (!ID_PATTERNS.key.test(value.name)) throw contractError('skillPackage.name must be lowercase kebab-case'); return cloneCanonical(value) }
  if (name === 'runLock') {
    checkId(value.runId, 'runId', 'run'); checkId(value.workspaceId, 'workspaceId', 'ws'); checkId(value.projectId, 'projectId', 'prj'); checkId(value.memoryNamespaceId, 'memoryNamespaceId', 'mem')
    if (typeof value.scopeKey !== 'string' || value.scopeKey.length === 0) throw contractError('runLock.scopeKey must be a canonical string identity')
    checkDigest(value.repositoryBindingDigest, 'repositoryBindingDigest')
    if (!Array.isArray(value.knowledge) || value.knowledge.length === 0) throw contractError('runLock.knowledge must contain an explicit Knowledge lock')
    for (const binding of value.knowledge) validateContract('knowledgeBinding', binding)
    checkDigest(value.agentPolicyDigest, 'agentPolicyDigest'); checkDigest(value.workflowScriptDigest, 'workflowScriptDigest'); checkDigest(value.policyDigest, 'policyDigest'); return cloneCanonical(value)
  }
  if (name === 'stageEvidence') {
    checkId(value.stageId, 'stageId', 'stage'); if (!Array.isArray(value.evidence) || value.evidence.length === 0) throw contractError('stageEvidence.evidence must be non-empty')
    for (const field of ['enteredAt', 'firstActionAt', 'exitedAt', 'waitingReason']) if (typeof value[field] !== 'string' || value[field].length === 0) throw contractError(`stageEvidence.${field} must be non-blank`)
    for (const field of ['durationMs', 'activeMs', 'waitingMs']) if (!Number.isSafeInteger(value[field]) || value[field] < 0) throw contractError(`stageEvidence.${field} must be a non-negative safe integer`)
    if (value.activeMs + value.waitingMs !== value.durationMs) throw contractError('stageEvidence.activeMs + waitingMs must equal durationMs')
    if (value.status !== 'unmeasured') {
      const entered = Date.parse(value.enteredAt); const firstAction = Date.parse(value.firstActionAt); const exited = Date.parse(value.exitedAt)
      if (![entered, firstAction, exited].every(Number.isFinite) || firstAction < entered || exited < firstAction) throw contractError('stageEvidence measured timestamps must be ordered ISO dates')
    }
    return cloneCanonical(value)
  }
  if (name === 'evaluatorResult') { checkId(value.evaluatorId, 'evaluatorId', 'agent'); if (!['passed', 'failed'].includes(value.status) || !Array.isArray(value.findings) || !Array.isArray(value.evidence)) throw contractError('evaluatorResult has invalid status/findings/evidence'); return cloneCanonical(value) }
  if (name === 'gateDecision') { checkId(value.gateId, 'gateId', 'gate'); checkDigest(value.inputDigest, 'inputDigest'); if (!['allowed', 'rejected', 'unavailable', 'cancelled', 'rework'].includes(value.outcome) || !isObject(value.approval)) throw contractError('gateDecision has invalid outcome or approval record'); return cloneCanonical(value) }
  if (name === 'memoryRecord') { checkId(value.projectId, 'projectId', 'prj'); checkId(value.namespaceId, 'namespaceId', 'mem'); checkDigest(value.provenance.digest, 'provenance.digest'); return cloneCanonical(value) }
  if (name === 'memoryCheckpoint' || name === 'memoryAudit' || name === 'memoryProjection' || name === 'memoryConflict') { checkId(value.projectId, 'projectId', 'prj'); checkId(value.namespaceId, 'namespaceId', 'mem'); checkDigest(value.provenance.digest, 'provenance.digest'); if (name === 'memoryProjection') checkDigest(value.contentDigest, 'contentDigest'); return cloneCanonical(value) }
  if (name === 'policyContext') { checkDigest(value.digest, 'digest'); return cloneCanonical(value) }
  if (name === 'projectConfigDraft') {
    if (!ID_PATTERNS.resource.test(value.draftId) || !value.draftId.startsWith('drf_')) throw contractError('projectConfigDraft.draftId must use the drf_ resource namespace')
    if (value.projectId !== undefined) checkId(value.projectId, 'projectId', 'prj')
    checkId(value.workspaceId, 'workspaceId', 'ws')
    if (value.baseRevision === undefined || !ID_PATTERNS.resource.test(value.baseRevision) || !value.baseRevision.startsWith('rev_')) throw contractError('projectConfigDraft.baseRevision must use the rev_ resource namespace')
    checkDigest(value.baseDigest, 'baseDigest')
    if (!value.actor?.identity) throw contractError('projectConfigDraft.actor.identity is required')
    return cloneCanonical(value)
  }
  if (name === 'projectConfigPreview') { checkId(value.previewId, 'previewId', 'ev'); checkId(value.draftId, 'draftId', 'drf'); checkId(value.workspaceId, 'workspaceId', 'ws'); checkId(value.projectId, 'projectId', 'prj'); checkDigest(value.baseDigest, 'baseDigest'); checkDigest(value.currentDigest, 'currentDigest'); return cloneCanonical(value) }
  if (name === 'projectConfigApplyResult') { checkId(value.applyId, 'applyId', 'ev'); checkId(value.workspaceId, 'workspaceId', 'ws'); checkId(value.projectId, 'projectId', 'prj'); checkId(value.revision, 'revision', 'rev'); checkDigest(value.digest, 'digest'); return cloneCanonical(value) }
  if (name === 'configHistoryEntry') { checkId(value.historyId, 'historyId', 'ev'); checkId(value.revision, 'revision', 'rev'); checkId(value.workspaceId, 'workspaceId', 'ws'); checkId(value.projectId, 'projectId', 'prj'); checkDigest(value.digest, 'digest'); return cloneCanonical(value) }
  if (name === 'responseEnvelope') { checkId(value.requestId, 'requestId', 'ev'); return cloneCanonical(value) }
  return cloneCanonical(value)
}

export function validateProjectBaseline(value) {
  try { ProjectBaselineSchema.parse(value) } catch (error) { throw contractError('Project baseline failed typed schema validation', { phase: 'contract-validation', actual: error instanceof Error ? error.message : String(error), cause: error }) }
  checkId(value.projectId, 'projectId', 'prj')
  if (!ID_PATTERNS.key.test(value.key)) throw contractError('projectBaseline.key must be lowercase kebab-case')
  if (value.schemaVersion !== CONTRACT_VERSION) throw contractError('projectBaseline.schemaVersion is unsupported', { expected: CONTRACT_VERSION, actual: value.schemaVersion })
  for (const field of ['displayName', 'owner', 'artifactRoot']) if (typeof value[field] !== 'string' || value[field].length === 0) throw contractError(`projectBaseline.${field} must be non-blank`)
  if (isAbsolute(value.artifactRoot) || value.artifactRoot.includes('\0') || value.artifactRoot.split(/[\\/]+/).includes('..')) throw contractError('projectBaseline.artifactRoot must be a relative path without traversal')
  if (!['public', 'internal', 'confidential', 'restricted'].includes(value.classification)) throw contractError('projectBaseline.classification is unsupported')
  if (!Array.isArray(value.repositories) || value.repositories.length === 0) throw contractError('projectBaseline.repositories must contain at least one repository')
  for (const repository of value.repositories) validateRepositoryBinding(repository, value)
  if (!Array.isArray(value.knowledgeBindings) || value.knowledgeBindings.length === 0) throw contractError('projectBaseline.knowledgeBindings must contain at least one binding')
  if (!Array.isArray(value.agentProfiles) || value.agentProfiles.length === 0) throw contractError('projectBaseline.agentProfiles must contain at least one profile')
  for (const binding of value.knowledgeBindings) validateContract('knowledgeBinding', binding)
  for (const profile of value.agentProfiles) validateContract('agentProfile', profile)
  if (!Array.isArray(value.skills)) throw contractError('projectBaseline.skills must be an array')
  for (const skill of value.skills) validateContract('skillPackage', skill)
  if (!isObject(value.memory) || typeof value.memory.namespaceId !== 'string') throw contractError('projectBaseline.memory.namespaceId is required')
  checkId(value.memory.namespaceId, 'memory.namespaceId', 'mem')
  if (typeof value.memory.retention !== 'string' || typeof value.memory.projection !== 'string') throw contractError('projectBaseline.memory.retention and projection are required')
  if (!isObject(value.qualityCommands) || Object.values(value.qualityCommands).some((command) => typeof command !== 'string' || command.length === 0)) throw contractError('projectBaseline.qualityCommands must contain non-blank command strings')
  return cloneCanonical(value)
}

export function bootstrapProjectBaseline(input) {
  if (!isObject(input) || !ID_PATTERNS.key.test(input.key)) throw contractError('bootstrap requires a lowercase kebab-case project key')
  const repository = input.repository ?? { name: input.key, root: `repos/${input.key}`, source: 'local' }
  const projectDigest = sha256Digest({ key: input.key, owner: input.owner, repository: repository.root }).slice(7, 19)
  const projectId = input.projectId ?? `prj_${projectDigest}`
  const knowledge = input.knowledge ?? { source: `knowledge/${input.key}`, revision: 'initial', scope: projectId, digest: sha256Digest({ key: input.key, source: 'knowledge' }), readOnly: false, trust: 'project', requiredCapabilities: [] }
  const agentId = `agent_${projectDigest}`
  const skillId = `skill_${projectDigest}`
  const baseline = {
    schemaVersion: CONTRACT_VERSION,
    projectId,
    key: input.key,
    displayName: input.displayName ?? input.key,
    owner: input.owner ?? 'unassigned',
    classification: input.classification ?? 'internal',
    lifecycle: 'active',
    repositories: [{ repoId: input.repositoryId ?? `repo_${projectDigest}`, name: repository.name, root: repository.root, pathTemplate: repository.pathTemplate ?? repository.root, source: repository.source ?? 'local', readOnly: repository.readOnly ?? false, owner: repository.owner ?? input.owner ?? 'unassigned', classification: repository.classification ?? input.classification ?? 'internal', worktrees: (repository.worktrees ?? []).map((worktree) => ({ ...worktree, owner: worktree.owner ?? input.owner ?? 'unassigned', classification: worktree.classification ?? input.classification ?? 'internal' })) }],
    knowledgeBindings: [{ knowledgeId: input.knowledgeId ?? `know_${projectDigest}`, source: knowledge.source, scope: knowledge.scope ?? projectId, revision: knowledge.revision, digest: knowledge.digest, readOnly: knowledge.readOnly ?? false, trust: knowledge.trust ?? 'project', requiredCapabilities: knowledge.requiredCapabilities ?? [] }],
    agentProfiles: [{ agentId, role: input.agentRole ?? 'project-operator', purpose: input.agentPurpose ?? 'Execute approved project stages', modelPolicyRef: input.modelPolicyRef ?? 'xiaobai-agent-policy/default', allowedSkills: [skillId], requiredContext: ['project-baseline', 'knowledge-lock', 'memory-namespace'], capabilities: input.capabilities ?? [], riskLevel: input.riskLevel ?? 'medium', humanGatePolicy: input.humanGatePolicy ?? 'required-for-delivery', outputContract: input.outputContract ?? 'stage-result/v1' }],
    skills: [{ skillId, name: input.skillName ?? 'project-context', version: input.skillVersion ?? '1.0.0', purpose: input.skillPurpose ?? 'Resolve project context', owner: input.owner ?? 'unassigned', invocation: { modelInvocable: true, userInvocable: true }, requiredContext: ['project-scope'], capabilities: input.skillCapabilities ?? [], sideEffects: [], evidenceRequirements: ['source-digest'], trust: 'project' }],
    memory: { namespaceId: input.memoryNamespaceId ?? `mem_${projectDigest}`, retention: 'project', projection: 'host-storage-domain' },
    artifactRoot: input.artifactRoot ?? `artifacts/${input.key}`,
    qualityCommands: { validate: input.qualityCommands?.validate ?? 'npm run validate', test: input.qualityCommands?.test ?? 'npm test' },
    policyRefs: { agent: input.agentPolicyRef ?? 'xiaobai-agent-policy/default', memory: input.memoryPolicyRef ?? 'xiaobai-memory-policy/default', workflow: input.workflowPolicyRef ?? 'xiaobai-workflow-policy/fixed-script', project: input.projectPolicyRef ?? 'xiaobai-project-policy/default' },
  }
  return validateProjectBaseline(baseline)
}

export function assessProjectBaseline(value) {
  const missing = []
  for (const field of requiredFields.projectBaseline) if (!value || value[field] === undefined) missing.push(field)
  const errors = []
  if (missing.length === 0) {
    try { validateProjectBaseline(value) } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
  }
  return { valid: missing.length === 0 && errors.length === 0, missing, blockers: errors.length > 0 ? ['XIAOBAI_BASELINE_INVALID'] : [], errors }
}
