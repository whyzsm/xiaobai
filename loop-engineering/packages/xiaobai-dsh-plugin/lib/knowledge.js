import { ERROR_CODES } from './constants.js'
import { sha256Digest, cloneCanonical } from './canonical.js'
import { validateContract } from './contracts.js'
import { XiaobaiError } from './errors.js'

export function resolveKnowledgeContext(baseline, knowledgeId, current = {}) {
  const binding = baseline.knowledgeBindings.find((candidate) => candidate.knowledgeId === knowledgeId)
  if (!binding) throw new XiaobaiError(ERROR_CODES.KNOWLEDGE_LOCK_REQUIRED, `Knowledge '${knowledgeId}' is not bound to project '${baseline.projectId}'`, { resourceId: knowledgeId, phase: 'knowledge-resolution', remediation: 'Add an explicit KnowledgeBinding to the project baseline.' })
  const normalized = validateContract('knowledgeBinding', binding)
  for (const field of ['revision', 'digest', 'scope']) {
    if (current[field] !== undefined && current[field] !== normalized[field]) throw new XiaobaiError(ERROR_CODES.LOCK_DRIFT, `Knowledge binding '${knowledgeId}' drifted at '${field}'`, { resourceId: knowledgeId, phase: 'knowledge-lock', expected: normalized[field], actual: current[field], remediation: 'Refresh the locked Knowledge revision and rerun the stage.' })
  }
  const contentDigest = current.contentDigest ?? normalized.digest
  return {
    ...normalized,
    contentDigest,
    trust: normalized.trust,
    requiredCapabilities: [...normalized.requiredCapabilities],
    contextDigest: sha256Digest({ ...normalized, contentDigest }),
  }
}

export function buildContextLock({ project, workspaceId, knowledge, agentPolicyDigest, skillRevision, memoryNamespaceId }) {
  if (!workspaceId) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Context lock requires a Host Workspace id', { phase: 'context-lock' })
  if (!knowledge) throw new XiaobaiError(ERROR_CODES.KNOWLEDGE_LOCK_REQUIRED, 'Context lock requires an explicit Knowledge binding', { resourceId: project.projectId, phase: 'context-lock' })
  return cloneCanonical({ workspaceId, projectId: project.projectId, knowledge, agentPolicyDigest, skillRevision, memoryNamespaceId, contextDigest: sha256Digest({ workspaceId, projectId: project.projectId, knowledge, agentPolicyDigest, skillRevision, memoryNamespaceId }) })
}
