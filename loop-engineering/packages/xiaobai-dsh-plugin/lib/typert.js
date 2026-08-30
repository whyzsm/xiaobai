import { PACKAGE_NAME } from './constants.js'
import {
  AgentProfileSchema,
  ConfigHistoryEntrySchema,
  GateDecisionSchema,
  KnowledgeBindingSchema,
  MemoryAuditSchema,
  MemoryCheckpointSchema,
  MemoryConflictSchema,
  MemoryProjectionSchema,
  MemoryRecordSchema,
  MemoryProvenanceSchema,
  MonitorProjectionSchema,
  PolicyContextSchema,
  ProjectBaselineSchema,
  ProjectConfigApplyResultSchema,
  ProjectConfigDraftSchema,
  ProjectConfigPreviewSchema,
  ProjectIdSchema,
  ResponseEnvelopeSchema,
  RunLockSchema,
  SkillPackageSchema,
  StageEvidenceSchema,
  WorkspaceConfigRequestSchema,
  CreateProjectDraftRequestSchema,
  ApplyProjectConfigRequestSchema,
  DirectoryPickRequestSchema,
  ProjectCandidatesRequestSchema,
  RollbackProjectConfigRequestSchema,
  CONFIG_REMOTE_INVOCATIONS,
} from './typed.js'

// Keep the rc.6 Gateway binding local so the plugin also works from a local link
// where peer packages are resolved by the dsh Host rather than this repository.
export function bindTypertRemote(service, serviceKey, options = {}) {
  const namespace = options.namespace ?? serviceKey
  if (!service || typeof service !== 'object') throw new TypeError('typert service must be an object')
  if (typeof serviceKey !== 'string' || serviceKey.length === 0) throw new TypeError('typert service key must be a non-empty string')
  if (typeof namespace !== 'string' || namespace.length === 0) throw new TypeError('typert namespace must be a non-empty string')
  return Object.freeze({ service, serviceKey, namespace })
}

const schemas = [
  ['ProjectId', ProjectIdSchema],
  ['KnowledgeBinding', KnowledgeBindingSchema],
  ['ProjectBaseline', ProjectBaselineSchema],
  ['RunLock', RunLockSchema],
  ['AgentProfile', AgentProfileSchema],
  ['SkillPackage', SkillPackageSchema],
  ['StageEvidence', StageEvidenceSchema],
  ['MemoryProvenance', MemoryProvenanceSchema],
  ['MemoryRecord', MemoryRecordSchema],
  ['MemoryCheckpoint', MemoryCheckpointSchema],
  ['MemoryAudit', MemoryAuditSchema],
  ['MemoryProjection', MemoryProjectionSchema],
  ['MemoryConflict', MemoryConflictSchema],
  ['PolicyContext', PolicyContextSchema],
  ['GateDecision', GateDecisionSchema],
  ['MonitorProjection', MonitorProjectionSchema],
  ['ProjectConfigDraft', ProjectConfigDraftSchema],
  ['ProjectConfigPreview', ProjectConfigPreviewSchema],
  ['ProjectConfigApplyResult', ProjectConfigApplyResultSchema],
  ['ConfigHistoryEntry', ConfigHistoryEntrySchema],
  ['ResponseEnvelope', ResponseEnvelopeSchema],
  ['WorkspaceConfigRequest', WorkspaceConfigRequestSchema],
  ['CreateProjectDraftRequest', CreateProjectDraftRequestSchema],
  ['ApplyProjectConfigRequest', ApplyProjectConfigRequestSchema],
  ['DirectoryPickRequest', DirectoryPickRequestSchema],
  ['ProjectCandidatesRequest', ProjectCandidatesRequestSchema],
  ['RollbackProjectConfigRequest', RollbackProjectConfigRequestSchema],
].map(([name, schema]) => ({ name, schema }))

const member = (name, signature) => ({ kind: 'method', name, signature })

export const TYPERT_MANIFEST = Object.freeze({
  package: PACKAGE_NAME,
  face: 'host',
  schemas,
  model: {
    services: [{
      key: 'xiaobaiConfig',
      exportName: 'WorkspaceConfigService',
      description: 'Host-owned Workspace and Project configuration lifecycle.',
      tags: [],
      members: [
        member('list', '(request: WorkspaceConfigRequest) => Promise<ResponseEnvelope>'),
        member('projectCandidates', '(request: ProjectCandidatesRequest) => Promise<ResponseEnvelope>'),
        member('get', '(request: WorkspaceConfigRequest) => Promise<ResponseEnvelope>'),
        member('createDraft', '(request: CreateProjectDraftRequest) => Promise<ResponseEnvelope>'),
        member('validate', '(request: ProjectConfigDraft) => Promise<ResponseEnvelope>'),
        member('preview', '(request: ProjectConfigDraft) => Promise<ResponseEnvelope>'),
        member('pickDirectory', '(request: DirectoryPickRequest) => Promise<ResponseEnvelope>'),
        member('requestApproval', '(request: ProjectConfigDraft) => Promise<ResponseEnvelope>'),
        member('apply', '(request: ApplyProjectConfigRequest) => Promise<ResponseEnvelope>'),
        member('history', '(request: WorkspaceConfigRequest) => Promise<ResponseEnvelope>'),
        member('rollback', '(request: RollbackProjectConfigRequest) => Promise<ResponseEnvelope>'),
      ],
      types: [],
    }],
    events: [{ name: 'workspace.config.changed', mode: 'emit', signature: '(event: WorkspaceConfigChanged) => void', tags: [] }],
    objects: [],
  },
  invocations: CONFIG_REMOTE_INVOCATIONS,
})
