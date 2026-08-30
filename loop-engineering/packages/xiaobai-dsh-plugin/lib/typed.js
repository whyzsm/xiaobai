import { z } from 'zod'
import { ERROR_CODES, LIFECYCLE_STATES, PACKAGE_NAME } from './constants.js'
import { getHostService } from './host.js'
import { XiaobaiError } from './errors.js'

export const ProjectIdSchema = z.string().regex(/^prj_[a-z0-9][a-z0-9_-]{2,63}$/)
export const KnowledgeBindingSchema = z.object({
  knowledgeId: z.string().regex(/^know_[a-z0-9][a-z0-9_-]{2,63}$/),
  source: z.string().min(1),
  scope: z.string().min(1),
  revision: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  readOnly: z.boolean(),
  trust: z.enum(['bundled', 'project', 'external', 'derived']),
  requiredCapabilities: z.array(z.string()),
}).strict()

export const MemoryProvenanceSchema = z.object({
  source: z.string().min(1),
  revision: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  scope: z.string().min(1),
  trust: z.enum(['bundled', 'project', 'external', 'derived']),
}).strict()

export const MemoryRecordSchema = z.object({
  projectId: ProjectIdSchema,
  namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  kind: z.enum(['state', 'inbox', 'decision', 'run', 'finding', 'metric']),
  body: z.record(z.string(), z.unknown()),
  sourceRef: z.string().min(1),
  createdAt: z.string().min(1),
  provenance: MemoryProvenanceSchema,
  retention: z.string().min(1),
  expiresAt: z.string().min(1).optional(),
}).strict()

export const MemoryCheckpointSchema = z.object({
  checkpointId: z.string().min(1),
  projectId: ProjectIdSchema,
  namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  auditDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sourceRef: z.string().min(1),
  createdAt: z.string().min(1),
  provenance: MemoryProvenanceSchema,
}).strict()

export const MemoryAuditSchema = z.object({
  auditId: z.string().min(1),
  projectId: ProjectIdSchema,
  namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  eventType: z.string().min(1),
  sourceEventRef: z.string().min(1),
  evidence: z.array(z.string()).min(1),
  createdAt: z.string().min(1),
  provenance: MemoryProvenanceSchema,
}).strict()

export const MemoryProjectionSchema = z.object({
  projectionId: z.string().min(1),
  projectId: ProjectIdSchema,
  namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  target: z.literal('obsidian'),
  path: z.string().min(1),
  contentDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  sourceRecordIds: z.array(z.string()),
  content: z.string(),
  createdAt: z.string().min(1),
  provenance: MemoryProvenanceSchema,
}).strict()

export const MemoryConflictSchema = z.object({
  conflictId: z.string().min(1),
  projectId: ProjectIdSchema,
  namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  recordKey: z.string().min(1),
  existingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  incomingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  createdAt: z.string().min(1),
  provenance: MemoryProvenanceSchema,
}).strict()

export const ResolvedContextSchema = z.object({
  source: z.string().min(1),
  revision: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  scope: z.string().min(1),
  trust: z.enum(['bundled', 'project', 'external', 'derived']),
  requiredCapabilities: z.array(z.string()),
}).strict()

export const PolicyContextSchema = z.object({
  kind: z.enum(['agent', 'memory', 'workflow', 'project', 'agent-profile']),
  policyId: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  source: z.string().min(1),
  revision: z.string().min(1),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  scope: z.string().min(1),
  trust: z.enum(['bundled', 'project', 'external', 'derived']),
  requiredCapabilities: z.array(z.string()),
}).strict()

const ClassificationSchema = z.enum(['public', 'internal', 'confidential', 'restricted'])
const WorktreeSchema = z.object({
  worktreeId: z.string().regex(/^worktree_[a-z0-9][a-z0-9_-]{2,63}$/),
  root: z.string().min(1),
  pathTemplate: z.string().min(1),
  readOnly: z.boolean(),
  owner: z.string().min(1),
  classification: ClassificationSchema,
}).strict()
const RepositorySchema = z.object({
  repoId: z.string().regex(/^repo_[a-z0-9][a-z0-9_-]{2,63}$/),
  name: z.string().min(1),
  root: z.string().min(1),
  pathTemplate: z.string().min(1),
  source: z.enum(['local', 'remote', 'mount']),
  readOnly: z.boolean(),
  owner: z.string().min(1),
  classification: ClassificationSchema,
  worktrees: z.array(WorktreeSchema),
}).strict()
const PolicyRefsSchema = z.object({
  agent: z.string().min(1),
  memory: z.string().min(1),
  workflow: z.string().min(1),
  project: z.string().min(1).optional(),
}).strict()

export const ProjectBaselineSchema = z.object({
  schemaVersion: z.literal('xiaobai.contracts/v1'),
  projectId: ProjectIdSchema,
  key: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
  displayName: z.string().min(1),
  owner: z.string().min(1),
  classification: ClassificationSchema,
  lifecycle: z.enum(LIFECYCLE_STATES).optional(),
  repositories: z.array(RepositorySchema).min(1),
  knowledgeBindings: z.array(KnowledgeBindingSchema).min(1),
  agentProfiles: z.array(z.object({
    agentId: z.string().regex(/^agent_[a-z0-9][a-z0-9_-]{2,63}$/),
    role: z.string().min(1),
    purpose: z.string().min(1),
    modelPolicyRef: z.string().min(1),
    allowedSkills: z.array(z.string()),
    requiredContext: z.array(z.string()),
    capabilities: z.array(z.string()),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    humanGatePolicy: z.string().min(1),
    outputContract: z.string().min(1),
  }).strict()).min(1),
  skills: z.array(z.object({
    skillId: z.string().regex(/^skill_[a-z0-9][a-z0-9_-]{2,63}$/),
    name: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/),
    version: z.string().min(1),
    purpose: z.string().min(1),
    owner: z.string().min(1),
    invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }).strict(),
    requiredContext: z.array(z.string()),
    capabilities: z.array(z.string()),
    sideEffects: z.array(z.string()),
    evidenceRequirements: z.array(z.string()),
    trust: z.enum(['bundled', 'project', 'external']),
  }).strict()),
  memory: z.object({ namespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/), retention: z.string().min(1), projection: z.string().min(1) }).strict(),
  artifactRoot: z.string().min(1),
  qualityCommands: z.object({ validate: z.string().min(1), test: z.string().min(1) }).strict(),
  policyRefs: PolicyRefsSchema.optional(),
}).strict()

export const AgentProfileSchema = z.object({
  agentId: z.string().regex(/^agent_[a-z0-9][a-z0-9_-]{2,63}$/),
  role: z.string().min(1), purpose: z.string().min(1), modelPolicyRef: z.string().min(1),
  allowedSkills: z.array(z.string()), requiredContext: z.array(z.string()), capabilities: z.array(z.string()),
  riskLevel: z.enum(['low', 'medium', 'high', 'critical']), humanGatePolicy: z.string().min(1), outputContract: z.string().min(1),
}).strict()

export const SkillPackageSchema = z.object({
  skillId: z.string().regex(/^skill_[a-z0-9][a-z0-9_-]{2,63}$/), name: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), version: z.string().min(1), purpose: z.string().min(1), owner: z.string().min(1),
  invocation: z.object({ modelInvocable: z.boolean(), userInvocable: z.boolean() }).strict(), requiredContext: z.array(z.string()), capabilities: z.array(z.string()), sideEffects: z.array(z.string()), evidenceRequirements: z.array(z.string()), trust: z.enum(['bundled', 'project', 'external']),
}).strict()

export const StageEvidenceSchema = z.object({
  stageId: z.string().regex(/^stage_[a-z0-9][a-z0-9_-]{2,63}$/), status: z.enum(['active', 'blocked', 'completed', 'failed', 'unmeasured']),
  enteredAt: z.string().min(1), firstActionAt: z.string().min(1), exitedAt: z.string().min(1), durationMs: z.number().int().nonnegative(), activeMs: z.number().int().nonnegative(), waitingMs: z.number().int().nonnegative(), waitingReason: z.string().min(1), evidence: z.array(z.string()).min(1), timingSource: z.enum(['host-session', 'plugin-clock', 'unmeasured']).optional(), waitingReasons: z.array(z.string()).optional(),
}).strict()

export const EvaluatorResultSchema = z.object({ evaluatorId: z.string().regex(/^agent_[a-z0-9][a-z0-9_-]{2,63}$/), status: z.enum(['passed', 'failed']), contractVersion: z.string().min(1), findings: z.array(z.record(z.string(), z.unknown())), evidence: z.array(z.string()) }).strict()
export const GateDecisionSchema = z.object({ gateId: z.string().regex(/^gate_[a-z0-9][a-z0-9_-]{2,63}$/), outcome: z.enum(['allowed', 'rejected', 'unavailable', 'cancelled', 'rework']), actor: z.string().min(1), reason: z.string().min(1), timestamp: z.string().min(1), inputDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), evidence: z.array(z.string()).min(1), approval: z.object({ outcome: z.enum(['allowed-once', 'rejected', 'cancelled', 'unavailable']), auditRequired: z.literal(true), asked: z.literal(true), decided: z.literal(true), requestId: z.string().min(1).optional() }).strict() }).strict()

const MonitorStageSchema = z.object({
  stageId: z.string().min(1),
  status: z.enum(['active', 'blocked', 'completed', 'failed', 'unmeasured']),
  enteredAt: z.string().nullable(),
  firstActionAt: z.string().nullable(),
  exitedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  activeMs: z.number().int().nonnegative().nullable(),
  waitingMs: z.number().int().nonnegative().nullable(),
  waitingReason: z.string().min(1),
  evidence: z.array(z.string()),
  timingSource: z.enum(['host-session', 'plugin-clock', 'unmeasured']),
  waitingReasons: z.array(z.string()),
}).strict()

export const MonitorProjectionSchema = z.object({
  schemaVersion: z.literal('xiaobai.monitor/v1'),
  generatedAt: z.string().min(1),
  workspace: z.object({ id: z.string().min(1), title: z.string().min(1), status: z.string().min(1), projectCount: z.number().int().nonnegative() }).strict(),
  projects: z.array(z.record(z.string(), z.unknown())),
  loops: z.array(z.record(z.string(), z.unknown())),
  runs: z.array(z.object({ runId: z.string().min(1), loopId: z.string().nullable(), projectId: z.string().nullable(), status: z.string().min(1), startedAt: z.string().nullable(), endedAt: z.string().nullable(), stages: z.array(MonitorStageSchema), evidence: z.array(z.string()) }).strict()),
  lineage: z.array(z.record(z.string(), z.unknown())),
  warnings: z.array(z.object({ code: z.string().min(1), severity: z.string().min(1), source: z.string().optional(), message: z.string().min(1) }).strict()),
}).strict()

export const RunLockSchema = z.object({
  schemaVersion: z.literal('xiaobai.contracts/v1'),
  runId: z.string().regex(/^run_[a-z0-9][a-z0-9_-]{2,63}$/),
  host: z.record(z.string(), z.unknown()),
  workspaceId: z.string().regex(/^ws_[a-z0-9][a-z0-9_-]{2,63}$/),
  projectId: ProjectIdSchema,
  scopeKey: z.string().min(1),
  knowledge: z.array(KnowledgeBindingSchema).min(1),
  repositoryBindingDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  agentPolicyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  skillRevision: z.string().min(1),
  workflowScriptDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  policyDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  memoryNamespaceId: z.string().regex(/^mem_[a-z0-9][a-z0-9_-]{2,63}$/),
  artifactRoot: z.string().min(1),
  createdAt: z.string().min(1),
}).strict()

const serviceModel = (key, exportName, members) => ({ key, exportName, members, types: [] })
const member = (name, signature) => ({ kind: 'method', name, signature })

export function registerTypedContracts(ctx) {
  const typert = getHostService(ctx, 'typert')
  if (!typert || typeof typert.register !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host typert.register is unavailable', { phase: 'typed-registration' })
  return typert.register({
    package: PACKAGE_NAME,
    face: 'host',
    schemas: [
      { name: 'ProjectId', schema: ProjectIdSchema },
      { name: 'KnowledgeBinding', schema: KnowledgeBindingSchema },
      { name: 'ProjectBaseline', schema: ProjectBaselineSchema },
      { name: 'RunLock', schema: RunLockSchema },
      { name: 'AgentProfile', schema: AgentProfileSchema },
      { name: 'SkillPackage', schema: SkillPackageSchema },
      { name: 'StageEvidence', schema: StageEvidenceSchema },
      { name: 'MemoryProvenance', schema: MemoryProvenanceSchema },
      { name: 'MemoryRecord', schema: MemoryRecordSchema },
      { name: 'MemoryCheckpoint', schema: MemoryCheckpointSchema },
      { name: 'MemoryAudit', schema: MemoryAuditSchema },
      { name: 'MemoryProjection', schema: MemoryProjectionSchema },
      { name: 'MemoryConflict', schema: MemoryConflictSchema },
      { name: 'PolicyContext', schema: PolicyContextSchema },
      { name: 'EvaluatorResult', schema: EvaluatorResultSchema },
      { name: 'GateDecision', schema: GateDecisionSchema },
      { name: 'MonitorProjection', schema: MonitorProjectionSchema },
    ],
    model: {
      services: [
        serviceModel('xiaobaiProject', 'ProjectRegistry', [member('attachWorkspace', '(path: string, title?: string) => Promise<Workspace>'), member('bootstrapBaseline', '(input: object, options?: object) => Promise<ProjectBaseline> | ProjectBaseline'), member('assessBaseline', '(baseline: object) => Assessment'), member('registerBaseline', '(baseline: ProjectBaseline) => ProjectBaseline'), member('openProject', '(projectId: ProjectId, options?: object) => ProjectScope'), member('openProjectForAgent', '(projectId: ProjectId, agent: HostAgent) => ProjectScope'), member('resolveRepository', '(projectId: ProjectId, repositoryId: string, options?: object) => Promise<RepositoryBinding>'), member('run', '(input: ProjectRunInput) => Promise<RunResult>')]),
        serviceModel('xiaobaiWorkspace', 'WorkspaceService', [member('load', '(input: object) => Promise<WorkspaceProjection>'), member('recover', '(input: object) => Promise<WorkspaceProjection>'), member('listProjects', '(input?: object) => WorkspaceProjection'), member('assessProject', '(input: object) => Assessment')]),
        serviceModel('xiaobaiLoops', 'LoopCatalogService', [member('load', '(workspaceRoot: string) => Promise<LoopCatalog>'), member('list', '(input?: object) => LoopCatalog'), member('assess', '(input: object) => LoopAssessment'), member('plan', '(input: object) => LoopPlan'), member('run', '(input: object) => Promise<RunResult>')]),
        serviceModel('xiaobaiMemory', 'MemoryDomain', [member('put', '(recordId: string, value: MemoryRecord) => Promise<MemoryRecord>'), member('get', '(recordId: string) => MemoryRecord | undefined'), member('checkpoint', '(value: MemoryCheckpoint) => Promise<MemoryCheckpoint>'), member('audit', '(value: MemoryAudit) => Promise<MemoryAudit>'), member('pruneExpired', '(now?: string | number | Date) => Promise<RetentionResult>'), member('projectObsidian', '(options: object) => Promise<MemoryProjection>')]),
        serviceModel('xiaobaiPolicy', 'PolicyService', [member('resolve', '(kind: string, project: ProjectBaseline, options?: object) => PolicyContext'), member('resolveAll', '(project: ProjectBaseline, options?: object) => Record<string, PolicyContext>')]),
      ],
      events: [
        { name: 'xiaobai/gate-decision', mode: 'emit', signature: '(decision: GateDecision) => void', tags: [] },
        { name: 'xiaobai/stage-success', mode: 'emit', signature: '(evidence: StageEvidence) => void', tags: [] },
      ],
      objects: [],
    },
    invocations: [],
  })
}
