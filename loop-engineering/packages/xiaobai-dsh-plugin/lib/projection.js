import { isAbsolute } from 'node:path'
import { sha256Digest } from './canonical.js'

const SCHEMA_VERSION = 'xiaobai.monitor/v1'
function opaqueId(prefix, value) {
  return `${prefix}_${sha256Digest(String(value ?? 'unknown')).slice(7, 19)}`
}

function safeLocator(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (isAbsolute(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value) || value.includes('\\')) return undefined
  return value.replace(/^\.\//, '')
}

function safeText(value, fallback = undefined) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (isAbsolute(value) || /^[a-z]:[\\/]/i.test(value) || /^\\\\|^\/\//.test(value) || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return fallback
  return value
    .replaceAll(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replaceAll(/((?:token|password|secret|credential))=\S+/gi, '$1=[redacted]')
    .replaceAll(/(^|[\s'"(])\/[^\s'"<>)]*/g, '$1[redacted-path]')
}

function evidenceRefs(values) {
  return (Array.isArray(values) ? values : [values])
    .map(safeLocator)
    .filter((value) => value !== undefined)
    .slice(0, 20)
}

function projectProjection(entry) {
  const baseline = entry?.baseline ?? entry
  const sourceProjectId = entry?.sourceProjectId ?? baseline?.key ?? entry?.id ?? 'unknown-project'
  const projectId = baseline?.projectId ?? opaqueId('prj', sourceProjectId)
  const repositoryStatuses = Array.isArray(entry?.repositoryStatuses) ? entry.repositoryStatuses : []
  const repositories = Array.isArray(baseline?.repositories)
    ? baseline.repositories
    : Array.isArray(entry?.repositories)
      ? entry.repositories
      : []
  const mountedRepositoryCount = repositoryStatuses.length > 0
    ? repositoryStatuses.filter((item) => item.status === 'locked').length
    : repositories.filter((item) => item.status === 'locked' || item.mounted === true).length
  return {
    projectId,
    sourceProjectId: safeText(sourceProjectId, 'unknown'),
    displayName: safeText(baseline?.displayName ?? baseline?.name ?? entry?.name, projectId),
    owner: safeText(baseline?.owner ?? entry?.owner, 'unassigned'),
    classification: safeText(baseline?.classification ?? entry?.classification, 'internal'),
    status: entry?.status ?? (entry?.knowledgeStatus === 'unavailable' ? 'attention' : 'loaded'),
    repositoryCount: repositories.length || Number(entry?.repositoryCount) || 0,
    mountedRepositoryCount,
    knowledgeStatus: entry?.knowledgeStatus
      ?? (entry?.background?.configured ? (entry.background.mounted ? 'locked' : 'unavailable') : 'missing'),
    memoryStatus: baseline?.memory?.namespaceId ? 'declared' : 'missing',
    memoryNamespaceId: baseline?.memory?.namespaceId,
    configDigest: baseline?.configDigest ?? entry?.configDigest,
    pathBindingDigest: entry?.pathBindingDigest,
  }
}

function normalizeStage(stage = {}) {
  const timing = stage.timing ?? stage
  const measured = ['enteredAt', 'firstActionAt', 'exitedAt'].every((field) => typeof timing[field] === 'string' && timing[field].length > 0)
    && Number.isSafeInteger(timing.durationMs)
    && Number.isSafeInteger(timing.activeMs)
    && Number.isSafeInteger(timing.waitingMs)
  return {
    stageId: safeText(stage.stageId ?? stage.id, 'stage-unknown'),
    status: measured ? safeText(timing.status, 'completed') : 'unmeasured',
    enteredAt: measured ? timing.enteredAt : null,
    firstActionAt: measured ? timing.firstActionAt : null,
    exitedAt: measured ? timing.exitedAt : null,
    durationMs: measured ? timing.durationMs : null,
    activeMs: measured ? timing.activeMs : null,
    waitingMs: measured ? timing.waitingMs : null,
    waitingReason: measured ? safeText(timing.waitingReason, 'unknown') : 'unmeasured',
    evidence: evidenceRefs(timing.evidence ?? stage.evidence),
    timingSource: measured ? safeText(timing.timingSource, 'host-session') : 'unmeasured',
    waitingReasons: Array.isArray(timing.waitingReasons) ? timing.waitingReasons.map((value) => safeText(value)).filter(Boolean) : [],
  }
}

function loopProjection(loop) {
  return {
    loopId: safeText(loop?.loopId ?? loop?.id, 'loop-unknown'),
    name: safeText(loop?.name, loop?.loopId ?? loop?.id ?? 'Unnamed loop'),
    owner: safeText(loop?.owner, 'unassigned'),
    source: safeLocator(loop?.source),
    sourceDigest: loop?.sourceDigest,
    targetProjectId: safeText(loop?.targetProjectId ?? loop?.project, null),
    orchestrator: safeText(loop?.orchestrator, null),
    generator: safeText(loop?.generator, null),
    harness: safeText(loop?.harness, null),
    evaluator: safeText(loop?.evaluator, null),
    requiredChecks: Array.isArray(loop?.requiredChecks) ? loop.requiredChecks.map((value) => safeText(value)).filter(Boolean) : [],
    humanGates: Array.isArray(loop?.humanGates) ? loop.humanGates.map((value) => safeText(value)).filter(Boolean) : [],
    stageCount: Number.isSafeInteger(loop?.stageCount) ? loop.stageCount : Array.isArray(loop?.stages) ? loop.stages.length : 0,
    executionStatus: safeText(loop?.executionStatus, 'plan-only'),
  }
}

function runProjection(run) {
  const stages = Array.isArray(run?.stages) ? run.stages.map(normalizeStage) : []
  return {
    runId: safeText(run?.runId ?? run?.id, opaqueId('run', run?.sourceRef ?? run?.loopId)),
    loopId: safeText(run?.loopId, null),
    projectId: safeText(run?.projectId, null),
    status: safeText(run?.status, stages.some((stage) => stage.status === 'failed') ? 'failed' : stages.length ? 'completed' : 'unmeasured'),
    startedAt: typeof run?.startedAt === 'string' ? run.startedAt : null,
    endedAt: typeof run?.endedAt === 'string' ? run.endedAt : null,
    stages,
    evidence: evidenceRefs(run?.evidence),
  }
}

function lineageForProject(project) {
  const baseline = project?.baseline ?? project
  const sourceProjectId = project?.sourceProjectId ?? baseline?.key ?? project?.id
  const projectId = baseline?.projectId ?? opaqueId('prj', sourceProjectId)
  if (!projectId) return []
  const knowledge = baseline.knowledgeBindings?.[0]
  const skill = baseline.skills?.[0]
  const agent = baseline.agentProfiles?.[0]
  const memory = baseline.memory
  const nodes = [
    { id: safeText(projectId, opaqueId('prj', projectId)), kind: 'project-baseline', status: project?.status ?? 'loaded', digest: project?.configDigest },
    knowledge && { id: safeText(knowledge.knowledgeId, opaqueId('know', projectId)), kind: 'knowledge-binding', status: project?.knowledgeStatus ?? 'unmeasured', digest: knowledge.digest },
    skill && { id: safeText(skill.skillId, opaqueId('skill', projectId)), kind: 'skill', status: 'declared', digest: undefined },
    agent && { id: safeText(agent.agentId, opaqueId('agent', projectId)), kind: 'agent-profile', status: 'declared', digest: undefined },
    memory && { id: safeText(memory.namespaceId, opaqueId('mem', projectId)), kind: 'memory-namespace', status: 'declared', digest: undefined },
  ].filter(Boolean)
  return [{
    projectId,
    nodes,
    edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })),
  }]
}

export function buildMonitorProjection(input = {}) {
  const loadedWorkspace = input.loadedWorkspace ?? input.workspace
  const entries = Array.isArray(loadedWorkspace?.projects) ? loadedWorkspace.projects : Array.isArray(input.projects) ? input.projects : []
  const requestedWorkspaceId = input.workspaceId ?? loadedWorkspace?.workspaceId ?? loadedWorkspace?.id
  const workspaceId = safeText(requestedWorkspaceId, opaqueId('ws', loadedWorkspace?.title ?? input.workspaceTitle ?? 'workspace'))
  const projects = entries.map(projectProjection)
  const loops = (Array.isArray(input.loops) ? input.loops : []).map(loopProjection)
  const runs = (Array.isArray(input.runs) ? input.runs : []).map(runProjection)
  const lineage = entries.flatMap(lineageForProject)
  const warnings = (Array.isArray(input.warnings) ? input.warnings : Array.isArray(loadedWorkspace?.diagnostics) ? loadedWorkspace.diagnostics : [])
    .map((warning) => ({
      code: safeText(warning?.code, 'unknown'),
      severity: safeText(warning?.severity, 'warning'),
      source: safeLocator(warning?.source ?? warning?.field),
      message: safeText(warning?.message, 'Projection warning'),
    }))
  const projection = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    workspace: {
      id: workspaceId,
      title: safeText(input.workspaceTitle ?? loadedWorkspace?.title, 'Xiaobai Workspace'),
      status: safeText(loadedWorkspace?.status ?? input.workspaceStatus, 'unmeasured'),
      projectCount: projects.length,
    },
    projects,
    loops,
    runs,
    lineage,
    warnings,
  }
  return projection
}

export function isSafeMonitorProjection(projection) {
  if (!projection || projection.schemaVersion !== SCHEMA_VERSION) return false
  const serialized = JSON.stringify(projection)
  return !serialized.includes('://')
    && !serialized.split(/\s+/).some((value) => /^[a-z]:[\\/]/i.test(value) || /^\\\\|^\/\//.test(value))
    && !serialized.split(/\s+/).some((value) => isAbsolute(value))
    && !/(password|secret|credential|authorization|access_token)\s*=\s*(?!\[redacted\])/i.test(serialized)
}

export const MONITOR_PROJECTION_SCHEMA_VERSION = SCHEMA_VERSION
