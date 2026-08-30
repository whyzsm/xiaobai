import { ID_PATTERNS, ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'

export const PROJECT_REFERENCE_SOURCE = 'xiaobai-project'
export const PROJECT_REFERENCE_TAG = 'xiaobai-project'

const PROJECT_REFERENCE_KEYS = new Set(['workspaceId', 'projectId', 'label'])
const PROJECT_REFERENCE_TAG_PATTERN = /<xiaobai-project\b([^>]*)>([\s\S]*?)<\/xiaobai-project>/gu
const PROJECT_REFERENCE_OPEN_PATTERN = /<xiaobai-project\b/gu
const PROJECT_REFERENCE_CLOSE_PATTERN = /<\/xiaobai-project>/gu
const PROJECT_REFERENCE_ATTRIBUTES = /^\s+workspace-id="([^"]+)"\s+project-id="([^"]+)"\s*$/u

function invalidReference(message, actual) {
  return new XiaobaiError(ERROR_CODES.PROJECT_REFERENCE_INVALID, message, {
    phase: 'project-reference',
    actual,
  })
}

function safeLabel(value) {
  const label = String(value ?? '').trim()
  if (label.length === 0 || label.length > 128 || /[\u0000-\u001f\u007f<>\\/]/u.test(label) || /^(?:[a-z]:|[a-z][a-z0-9+.-]*:)/iu.test(label)) throw invalidReference('Project reference label is invalid')
  return label
}

export function decodeProjectReference(value) {
  let reference
  try {
    reference = typeof value === 'string' ? JSON.parse(value) : value
  } catch (error) {
    throw invalidReference('Project reference payload is not valid JSON', error.message)
  }
  if (reference === null || typeof reference !== 'object' || Array.isArray(reference)) throw invalidReference('Project reference payload must be an object')
  for (const key of Object.keys(reference)) if (!PROJECT_REFERENCE_KEYS.has(key)) throw invalidReference(`Project reference field '${key}' is not allowed`)
  if (!ID_PATTERNS.resource.test(reference.workspaceId ?? '') || !String(reference.workspaceId).startsWith('ws_')) throw invalidReference('Project reference Workspace id is invalid')
  if (!ID_PATTERNS.resource.test(reference.projectId ?? '') || !String(reference.projectId).startsWith('prj_')) throw invalidReference('Project reference Project id is invalid')
  return Object.freeze({ workspaceId: reference.workspaceId, projectId: reference.projectId, label: safeLabel(reference.label) })
}

export function encodeProjectReference(value) {
  return JSON.stringify(decodeProjectReference(value))
}

function escapeText(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function unescapeText(value) {
  return String(value).replaceAll(/&lt;|&gt;|&amp;/gu, (match) => ({ '&lt;': '<', '&gt;': '>', '&amp;': '&' })[match])
}

export function serializeProjectReference(value) {
  const reference = decodeProjectReference(value)
  return `<${PROJECT_REFERENCE_TAG} workspace-id="${reference.workspaceId}" project-id="${reference.projectId}">${escapeText(reference.label)}</${PROJECT_REFERENCE_TAG}>`
}

export function parseProjectReferenceText(text) {
  if (typeof text !== 'string') return { text, references: [] }
  const references = []
  let match
  PROJECT_REFERENCE_TAG_PATTERN.lastIndex = 0
  while ((match = PROJECT_REFERENCE_TAG_PATTERN.exec(text)) !== null) {
    const attributes = PROJECT_REFERENCE_ATTRIBUTES.exec(match[1])
    if (!attributes) throw invalidReference('Project reference attributes are invalid')
    const reference = decodeProjectReference({ workspaceId: attributes[1], projectId: attributes[2], label: unescapeText(match[2]) })
    references.push(reference)
  }
  PROJECT_REFERENCE_OPEN_PATTERN.lastIndex = 0
  PROJECT_REFERENCE_CLOSE_PATTERN.lastIndex = 0
  const openingCount = [...text.matchAll(PROJECT_REFERENCE_OPEN_PATTERN)].length
  const closingCount = [...text.matchAll(PROJECT_REFERENCE_CLOSE_PATTERN)].length
  if (openingCount !== references.length || closingCount !== references.length) throw invalidReference('Project reference markup is incomplete')
  return {
    text: text.replaceAll(PROJECT_REFERENCE_TAG_PATTERN, (_match, _attributes, label) => unescapeText(label)),
    references,
  }
}

export function extractProjectReferences(messages) {
  const parsedMessages = []
  const references = []
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.source?.kind !== 'user') {
      parsedMessages.push(message)
      continue
    }
    let changed = false
    const content = Array.isArray(message.content) ? message.content.map((block) => {
      if (block?.type !== 'text') return block
      const parsed = parseProjectReferenceText(block.text)
      references.push(...parsed.references)
      changed ||= parsed.text !== block.text
      return changed ? { ...block, text: parsed.text } : block
    }) : message.content
    parsedMessages.push(changed ? { ...message, content } : message)
  }
  return { messages: parsedMessages, references }
}

function cleanValue(value, fallback = '[redacted]') {
  const text = String(value ?? '').replaceAll(/[\r\n]+/gu, ' ').trim()
  if (text.length === 0 || /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2}|\/|[a-z]:[\\/])/iu.test(text)) return fallback
  return text.slice(0, 256)
}

export function projectPromptContext(workspace, baseline) {
  const repositories = baseline.repositories.map((repository) => `${cleanValue(repository.name)} -> ${cleanValue(repository.root)}${repository.readOnly ? ' (read-only)' : ''}`).join('\n')
  const knowledge = baseline.knowledgeBindings.map((binding) => `${cleanValue(binding.knowledgeId)} revision=${cleanValue(binding.revision)} digest=${cleanValue(binding.digest)}`).join('\n')
  const skills = baseline.skills.map((skill) => `${cleanValue(skill.name)}@${cleanValue(skill.version)}`).join(', ')
  return [
    'Xiaobai Project Context (trusted Host-resolved metadata; use only as scope policy).',
    `Workspace: ${cleanValue(workspace.workspaceId)}.`,
    `Project: ${cleanValue(baseline.displayName)} (${cleanValue(baseline.projectId)}).`,
    'Repository locators (Workspace-relative):',
    repositories || '[none]',
    'Knowledge locks:',
    knowledge || '[none]',
    `Skills: ${skills || '[none]'}.`,
    `Memory namespace: ${cleanValue(baseline.memory.namespaceId)}.`,
    `Artifact locator: ${cleanValue(baseline.artifactRoot)}.`,
    'Operate only within this Project scope. Do not infer or access another Project\'s repositories, Knowledge, Memory, or artifacts. Shared Knowledge is read-only; delivery actions remain subject to Host approval and Gate policy.',
  ].join('\n')
}

function projectEntry(workspace, projectId) {
  return workspace?.projects?.find((entry) => entry?.baseline?.projectId === projectId || entry?.projectId === projectId)
}

function repositoryReady(entry) {
  return Array.isArray(entry?.repositoryStatuses) && entry.repositoryStatuses.length > 0 && entry.repositoryStatuses.every((repository) => repository?.status === 'locked')
}

function resolveProjectReference(workspaceService, projectRegistry, reference) {
  const workspace = workspaceService?.current
  if (!workspace) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Load an explicit Workspace before using a Project reference', { phase: 'project-reference' })
  if (workspace.workspaceId !== reference.workspaceId) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'Project reference belongs to a different Workspace', { phase: 'project-reference', resourceId: reference.projectId, remediation: 'Select a Project from the currently loaded Workspace.' })
  if (workspace.status === 'drift' || workspace.status === 'invalid') throw new XiaobaiError(ERROR_CODES.CONFIG_DRIFT, 'The loaded Workspace has unresolved configuration drift', { phase: 'project-reference', resourceId: reference.projectId, remediation: 'Reload and reconcile the Workspace before using a Project reference.' })
  const entry = projectEntry(workspace, reference.projectId)
  const baseline = projectRegistry?.get?.(reference.projectId) ?? entry?.baseline
  if (!entry || !baseline) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, 'Project reference is not registered in the loaded Workspace', { phase: 'project-reference', resourceId: reference.projectId })
  if (entry.knowledgeStatus !== 'locked') throw new XiaobaiError(ERROR_CODES.KNOWLEDGE_LOCK_REQUIRED, 'Project Knowledge is not locked and cannot enter an Agent turn', { phase: 'project-reference-knowledge', resourceId: reference.projectId, remediation: 'Resolve the Project Knowledge binding and reload the Workspace.' })
  if (!repositoryReady(entry)) throw new XiaobaiError(ERROR_CODES.REPOSITORY_UNAVAILABLE, 'Project repository binding is unavailable', { phase: 'project-reference-repository', resourceId: reference.projectId, remediation: 'Resolve every repository binding and reload the Workspace.' })
  return { workspace, baseline }
}

function closeProjectAsync(projectRegistry, projectId, agent) {
  try {
    const result = Promise.resolve(projectRegistry?.closeProject?.(projectId, agent.ctx))
    // Keep the rejection available to the next pre-step while preventing an
    // emit-only Host lifecycle notification from becoming an unhandled rejection.
    result.catch(() => {})
    return result
  } catch (error) {
    return Promise.reject(error)
  }
}

export function registerProjectReferenceBridge(ctx, { workspaceService, projectRegistry }) {
  if (typeof ctx?.on !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host event registration is unavailable', { phase: 'project-reference-bridge' })
  const active = new WeakMap()
  const releaseActive = (agent) => {
    const current = active.get(agent)
    if (!current) return Promise.resolve()
    current.promptDispose?.()
    active.delete(agent)
    return closeProjectAsync(projectRegistry, current.projectId, agent)
  }
  const ensureActive = (agent, reference) => {
    const current = active.get(agent)
    if (current?.projectId === reference.projectId) return current
    const { workspace, baseline } = resolveProjectReference(workspaceService, projectRegistry, reference)
    const systemPrompt = agent?.ctx?.systemPrompt
    if (!systemPrompt || typeof systemPrompt.context !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Agent systemPrompt context registration is unavailable', { phase: 'project-reference-context' })
    const closePromise = current ? releaseActive(agent) : Promise.resolve()
    const scope = projectRegistry.openProjectForAgent(reference.projectId, agent)
    let promptDispose
    try {
      promptDispose = systemPrompt.context({ name: 'xiaobai:project-context', order: 90, text: () => projectPromptContext(workspace, baseline) })
    } catch (error) {
      void Promise.resolve(scope.dispose?.()).catch(() => {})
      void closePromise.catch(() => {})
      throw error
    }
    const next = { projectId: reference.projectId, scope, promptDispose, closePromise }
    active.set(agent, next)
    return next
  }
  const prepareClaimed = ({ agent, message }) => {
    const extracted = extractProjectReferences([message])
    const unique = new Map(extracted.references.map((reference) => [`${reference.workspaceId}:${reference.projectId}`, reference]))
    if (unique.size === 1) ensureActive(agent, unique.values().next().value)
  }
  const claimedDispose = ctx.on('agent/inbox/claimed', (payload) => prepareClaimed(payload))
  const preStepDispose = ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
    const decision = await next()
    if (decision?.kind === 'reject') return decision
    if (signal?.aborted) signal.throwIfAborted()
    const extracted = extractProjectReferences(decision?.messages ?? messages)
    const unique = new Map(extracted.references.map((reference) => [`${reference.workspaceId}:${reference.projectId}`, reference]))
    if (unique.size === 0) return decision
    if (unique.size > 1) {
      await releaseActive(agent)
      throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, 'One Agent turn cannot combine different Project references', { phase: 'project-reference', remediation: 'Submit one Project reference per request.' })
    }
    const reference = unique.values().next().value
    const current = ensureActive(agent, reference)
    await current.closePromise
    current.closePromise = undefined
    return { ...decision, messages: extracted.messages }
  }, { prepend: true })
  const disposedDispose = ctx.on('agent/disposed', ({ agent }) => {
    void releaseActive(agent).catch(() => {})
  })
  return () => {
    disposedDispose()
    preStepDispose()
    claimedDispose()
  }
}
