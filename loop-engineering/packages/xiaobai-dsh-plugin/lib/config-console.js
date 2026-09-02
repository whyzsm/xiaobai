import { randomUUID } from 'node:crypto'
import { access, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import YAML from 'yaml'
import { CONFIG_CONTRACT_VERSION, CONTRACT_VERSION, ERROR_CODES, ID_PATTERNS } from './constants.js'
import { cloneCanonical, sha256Digest } from './canonical.js'
import { getHostService } from './host.js'
import { XiaobaiError } from './errors.js'
import { validateContract, validateProjectBaseline } from './contracts.js'
import { bindTypertRemote } from './typert.js'
import { redactLoadedWorkspace } from './workspace.js'

const CONFIG_ROOT = 'projects'

function resourceId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`
}

function shortResource(prefix, value) {
  return `${prefix}_${sha256Digest(value).slice(7, 19)}`
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeKey(value, fallback = 'project') {
  const normalized = String(value ?? fallback).toLowerCase().replaceAll(/[^a-z0-9-]/g, '-').replaceAll(/-+/g, '-').replace(/^-|-$/g, '')
  return ID_PATTERNS.key.test(normalized) ? normalized : fallback
}

function safeLocator(value, fallback) {
  if (typeof value !== 'string' || value.length === 0) return fallback
  if (/^(?:[a-z][a-z0-9+.-]*:|\\\\|\/\/|\/)/iu.test(value) || value.includes('\0') || value.split(/[\\/]+/u).includes('..')) return fallback
  return value.replaceAll('\\', '/')
}

function safeCandidateText(value, fallback) {
  const text = String(value ?? '').trim()
  if (text.length === 0 || text.length > 128 || /[\u0000-\u001f\u007f<>\\/]/u.test(text) || /^(?:[a-z]:|[a-z][a-z0-9+.-]*:)/iu.test(text)) return fallback
  return text
}

function redactText(value) {
  return String(value ?? 'Configuration operation failed')
    .replaceAll(/https?:\/\/[^\s)]+/giu, '[redacted-url]')
    .replaceAll(/(?:[a-z]:[\\/]|\\\\|\/)[^\s'"()<>]+/gu, '[redacted-path]')
    .replaceAll(/((?:token|password|secret|credential))=\S+/giu, '$1=[redacted]')
}

function diagnostic(error, fallbackCode = ERROR_CODES.CONFIG_INVALID, field) {
  return {
    code: error?.code ?? fallbackCode,
    severity: 'error',
    ...(field ? { field } : {}),
    message: redactText(error?.message ?? error),
    ...(error?.phase ? { phase: error.phase } : {}),
    ...(error?.resourceId ? { resourceId: error.resourceId } : {}),
  }
}

function normalizeDiagnostic(value) {
  const source = isObject(value) ? value : { message: value }
  const code = typeof source.code === 'string' && source.code.length > 0 ? source.code : ERROR_CODES.CONFIG_INVALID
  const severity = ['info', 'warning', 'error'].includes(source.severity) ? source.severity : 'error'
  const rawField = typeof source.field === 'string' && source.field.length > 0 ? source.field : undefined
  const field = rawField
    ? /^(?:[a-z]:[\\/]|\\\\|\/|\/\/|[a-z][a-z0-9+.-]*:)/iu.test(rawField) ? redactText(rawField) : rawField
    : undefined
  const resourceId = typeof source.resourceId === 'string' && source.resourceId.length > 0
    ? source.resourceId
    : ID_PATTERNS.resource.test(source.projectId ?? '')
      ? source.projectId
      : undefined
  return {
    code,
    severity,
    ...(field ? { field } : {}),
    message: redactText(source.message ?? source),
    ...(typeof source.phase === 'string' && source.phase.length > 0 ? { phase: source.phase } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(typeof source.evidenceRef === 'string' && source.evidenceRef.length > 0 ? { evidenceRef: source.evidenceRef } : {}),
  }
}

function statusForError(error) {
  switch (error?.code) {
    case ERROR_CODES.CONFIG_CONFLICT:
    case ERROR_CODES.CONFIG_DRIFT:
      return 'conflict'
    case ERROR_CODES.APPROVAL_REQUIRED:
      return 'approval_required'
    case ERROR_CODES.HOST_UNSUPPORTED:
      return 'unsupported'
    default:
      return error?.code === ERROR_CODES.CONFIG_INVALID || error?.code === ERROR_CODES.CONTRACT_INVALID ? 'invalid' : 'failed'
  }
}

function envelope(status, data, diagnostics = [], details = {}) {
  return validateContract('responseEnvelope', {
    schemaVersion: CONFIG_CONTRACT_VERSION,
    requestId: resourceId('ev'),
    status,
    ...(data === undefined ? {} : { data }),
    diagnostics: diagnostics.map(normalizeDiagnostic),
    ...(details.errorCode ? { errorCode: details.errorCode } : {}),
    ...(details.phase ? { phase: details.phase } : {}),
    ...(details.resourceId ? { resourceId: details.resourceId } : {}),
    ...(details.evidenceRef ? { evidenceRef: details.evidenceRef } : {}),
  })
}

function failureEnvelope(error) {
  const details = error instanceof XiaobaiError ? error.toJSON() : {}
  return envelope(statusForError(error), undefined, [diagnostic(error)], {
    errorCode: details.code ?? error?.code ?? ERROR_CODES.CONFIG_INVALID,
    phase: details.phase ?? 'config-console',
    resourceId: details.resourceId,
    evidenceRef: details.evidenceRef,
  })
}

async function pathExists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function assertWorkspacePath(workspaceRoot, target) {
  const relation = relative(workspaceRoot, target)
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Configuration target escapes the Workspace root', { phase: 'config-path' })
  }
  return target
}

async function fileSnapshot(path) {
  if (!(await pathExists(path))) return { exists: false, content: undefined, digest: null }
  const content = await readFile(path, 'utf8')
  return { exists: true, content, digest: sha256Digest(content) }
}

async function writeFileDurably(path, content) {
  const handle = await open(path, 'w')
  try {
    await handle.writeFile(content, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function restoreSnapshot(path, snapshot) {
  if (snapshot.exists) {
    await writeFileDurably(path, snapshot.content)
    return
  }
  try { await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

async function atomicWriteSet(files) {
  const snapshots = await Promise.all(files.map(async (file) => ({ ...file, snapshot: await fileSnapshot(file.path) })))
  const temporary = []
  try {
    for (const file of files) {
      await mkdir(dirname(file.path), { recursive: true })
      const tempPath = `${file.path}.tmp-${randomUUID().replaceAll('-', '')}`
      temporary.push(tempPath)
      await writeFileDurably(tempPath, file.content)
    }
    for (let index = 0; index < files.length; index += 1) await rename(temporary[index], files[index].path)
    return snapshots
  } catch (error) {
    for (const path of temporary) { try { await unlink(path) } catch (cleanupError) { if (cleanupError.code !== 'ENOENT') error.cleanupError = cleanupError } }
    for (const file of snapshots) { try { await restoreSnapshot(file.path, file.snapshot) } catch (restoreError) { error.restoreError = restoreError } }
    throw error
  }
}

function projectIdFor(workspaceId, config) {
  // Keep the identity formula aligned with WorkspaceService's source-project
  // loader so an applied config reloads the same Project scope.
  return config.projectId ?? shortResource('prj', { sourceProjectId: config.key })
}

function resourceFor(prefix, current, seed) {
  return current ?? shortResource(prefix, seed)
}

function baselineToConfig(entry) {
  const baseline = entry.baseline
  return {
    key: baseline.key,
    displayName: baseline.displayName,
    owner: baseline.owner,
    classification: baseline.classification,
    repositories: baseline.repositories.map((repository) => ({
      repoId: repository.repoId,
      name: repository.name,
      source: repository.source,
      bindingRef: repository.source === 'local' ? repository.repoId : undefined,
      locator: safeLocator(repository.root, `repositories/${safeKey(repository.name, 'repository')}`),
      readOnly: repository.readOnly,
      classification: repository.classification,
    })),
    knowledgeBindings: baseline.knowledgeBindings.map((binding) => ({
      knowledgeId: binding.knowledgeId,
      source: binding.source,
      ...(entry.background?.bindingRef ? { bindingRef: entry.background.bindingRef } : {}),
      locator: safeLocator(binding.source),
      scope: binding.scope,
      revision: binding.revision,
      digest: binding.digest,
      readOnly: binding.readOnly,
      trust: binding.trust,
      requiredCapabilities: [...(binding.requiredCapabilities ?? [])],
    })),
    agentProfiles: baseline.agentProfiles.map((profile) => ({ ...profile })),
    skills: baseline.skills.map((skill) => ({
      skillId: skill.skillId,
      name: skill.name,
      version: skill.version,
      purpose: skill.purpose,
      owner: skill.owner,
      capabilities: [...skill.capabilities],
      trust: skill.trust,
    })),
    memory: { ...baseline.memory },
    artifact: { locator: safeLocator(baseline.artifactRoot, `artifacts/${baseline.key}`), readOnly: false },
    qualityCommands: { ...baseline.qualityCommands },
    ...(entry.parentGroupId ? { parentGroupId: entry.parentGroupId } : {}),
    ...(entry.sharedContextId ? { sharedContextId: entry.sharedContextId } : {}),
  }
}

function configToBaseline(config, workspaceId, projectId) {
  const effectiveProjectId = projectIdFor(workspaceId, { ...config, projectId })
  const repositoryList = config.repositories.map((repository, index) => {
    const repoId = resourceFor('repo', repository.repoId, { effectiveProjectId, name: repository.name, index })
    const locator = safeLocator(repository.locator, `repositories/${safeKey(repository.name, `repository-${index + 1}`)}`)
    return {
      repoId,
      name: repository.name,
      root: locator,
      pathTemplate: locator,
      source: repository.source,
      readOnly: repository.readOnly,
      owner: config.owner,
      classification: repository.classification,
      worktrees: [],
    }
  })
  const knowledgeBindings = config.knowledgeBindings.map((binding, index) => ({
    knowledgeId: resourceFor('know', binding.knowledgeId, { effectiveProjectId, source: binding.source, index }),
    source: binding.source,
    scope: binding.scope ?? effectiveProjectId,
    revision: binding.revision,
    digest: binding.digest,
    readOnly: binding.readOnly,
    trust: binding.trust,
    requiredCapabilities: [...(binding.requiredCapabilities ?? [])],
  }))
  const skills = config.skills.map((skill, index) => ({
    skillId: resourceFor('skill', skill.skillId, { effectiveProjectId, name: skill.name, index }),
    name: skill.name,
    version: skill.version,
    purpose: skill.purpose,
    owner: skill.owner,
    invocation: { modelInvocable: true, userInvocable: true },
    requiredContext: ['project-scope'],
    capabilities: [...skill.capabilities],
    sideEffects: [],
    evidenceRequirements: ['source-digest'],
    trust: skill.trust,
  }))
  const skillIds = new Set(skills.map((skill) => skill.skillId))
  const agentProfiles = config.agentProfiles.map((profile, index) => ({
    agentId: resourceFor('agent', profile.agentId, { effectiveProjectId, role: profile.role, index }),
    role: profile.role,
    purpose: profile.purpose,
    modelPolicyRef: profile.modelPolicyRef,
    allowedSkills: profile.allowedSkills.map((skill) => skillIds.has(skill) ? skill : skill),
    requiredContext: [...profile.requiredContext],
    capabilities: [...profile.capabilities],
    riskLevel: profile.riskLevel,
    humanGatePolicy: profile.humanGatePolicy,
    outputContract: profile.outputContract,
  }))
  return validateProjectBaseline({
    schemaVersion: CONTRACT_VERSION,
    projectId: effectiveProjectId,
    key: config.key,
    displayName: config.displayName,
    owner: config.owner,
    classification: config.classification,
    lifecycle: 'active',
    repositories: repositoryList,
    knowledgeBindings,
    agentProfiles,
    skills,
    memory: { ...config.memory },
    artifactRoot: safeLocator(config.artifact.locator, `artifacts/${config.key}`),
    qualityCommands: { ...config.qualityCommands },
    policyRefs: {
      agent: 'xiaobai-agent-policy/default',
      memory: 'xiaobai-memory-policy/default',
      workflow: 'xiaobai-workflow-policy/fixed-script',
      project: 'xiaobai-project-policy/default',
    },
  })
}

function sourceProjectConfig(config, metadata = {}) {
  const sourceConfig = metadata.sourceConfig
  const parentGroupId = metadata.parentGroupId ?? config.parentGroupId
  const sharedContextId = metadata.sharedContextId ?? config.sharedContextId
  const repositories = config.repositories.map((repository, index) => ({
    ...repository,
    repoId: repository.repoId ?? shortResource('repo', { key: config.key, name: repository.name, index }),
    ...(repository.source === 'local' && !repository.bindingRef ? { bindingRef: shortResource('binding', { key: config.key, name: repository.name, index }) } : {}),
  }))
  const source = {
    kind: parentGroupId ? 'Project' : sourceConfig?.kind ?? 'ProjectGroup',
    id: config.key,
    name: config.displayName,
    root: sourceConfig?.root ?? '.',
    defaultBranch: sourceConfig?.defaultBranch ?? 'master',
    ...(sourceConfig?.skill ? { skill: sourceConfig.skill } : {}),
    ...(sourceConfig?.discoverySkills ? { discoverySkills: sourceConfig.discoverySkills } : {}),
    owner: config.owner,
    classification: config.classification,
    ...(parentGroupId ? { parentGroup: parentGroupId } : {}),
    ...(sharedContextId ? { sharedContext: sharedContextId } : sourceConfig?.sharedContext ? { sharedContext: sourceConfig.sharedContext } : {}),
    repositories: repositories.map((repository, index) => ({
      id: repository.repoId,
      name: repository.name,
      mount: safeLocator(sourceConfig?.repositories?.[index]?.mount, 'repositories/' + safeKey(repository.name, 'repository')),
      ...(repository.bindingRef ? { localPathKey: repository.bindingRef } : {}),
      readOnly: repository.readOnly,
      ...(sourceConfig?.repositories?.[index]?.remote ? { remote: sourceConfig.repositories[index].remote } : {}),
    })),
    qualityCommands: { ...config.qualityCommands },
  }
  // Persist every explicit context binding so a reload does not collapse the
  // Project back to the legacy first-background-only representation.
  if (Array.isArray(config.knowledgeBindings) && config.knowledgeBindings.length > 0) {
    source.knowledgeBindings = config.knowledgeBindings.map((binding) => ({
      ...(binding.knowledgeId ? { knowledgeId: binding.knowledgeId } : {}),
      source: binding.source,
      revision: binding.revision,
      digest: binding.digest,
      readOnly: binding.readOnly,
      trust: binding.trust,
      requiredCapabilities: [...(binding.requiredCapabilities ?? [])],
      ...(binding.scope ? { scope: binding.scope } : {}),
    }))
  }
  const firstBinding = config.knowledgeBindings[0]
  const legacyBackgroundBinding = firstBinding &&
    (firstBinding.source.startsWith('skill-context:') || firstBinding.source.startsWith('background:'))
  if (!parentGroupId && legacyBackgroundBinding) {
    source.background = {
      id: firstBinding.knowledgeId ?? safeKey(firstBinding.source, 'project-background'),
      ...(firstBinding.locator ? { mount: safeLocator(firstBinding.locator, undefined) } : {}),
      ...(firstBinding.bindingRef ? { localPathKey: firstBinding.bindingRef } : {}),
      integration: { contractVersion: firstBinding.revision },
    }
  }
  if (sourceConfig?.localPaths) source.localPaths = sourceConfig.localPaths
  if (sourceConfig?.children) source.children = sourceConfig.children
  return source
}

function safeLocalBinding(value) {
  const binding = typeof value === 'string' ? { path: value } : value
  if (!isObject(binding) || typeof binding.path !== 'string' || !isAbsolute(binding.path)) return undefined
  return binding.path
}

function localBinding(value) {
  const binding = typeof value === 'string' ? { path: value } : value
  const path = safeLocalBinding(binding)
  if (!path) return undefined
  return {
    path,
    approvedRoots: Array.isArray(binding.approvedRoots) && binding.approvedRoots.length > 0
      ? binding.approvedRoots.filter((root) => typeof root === 'string' && isAbsolute(root))
      : [path],
  }
}

function pathWithinRoot(candidate, root) {
  const relation = relative(root, candidate)
  return relation === '' || (relation !== '..' && !relation.startsWith(`..${sep}`) && !isAbsolute(relation))
}

async function assertSafeWriteTarget(workspaceRoot, target) {
  const canonicalWorkspace = await realpath(workspaceRoot)
  let parent = dirname(target)
  while (!(await pathExists(parent))) {
    const next = dirname(parent)
    if (next === parent) break
    parent = next
  }
  const canonicalParent = await realpath(parent)
  if (!pathWithinRoot(canonicalParent, canonicalWorkspace)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Configuration target escapes the Workspace root through a symlink', { phase: 'config-path' })
  if (await pathExists(target)) {
    const canonicalTarget = await realpath(target)
    if (!pathWithinRoot(canonicalTarget, canonicalWorkspace)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Configuration target escapes the Workspace root through a symlink', { phase: 'config-path' })
  }
  return target
}

export class WorkspaceConfigService {
  constructor(ctx, workspaceService, options = {}) {
    this.ctx = ctx
    this.workspaceService = workspaceService
    this.options = options
    this.bindings = new Map()
    this.typertRemote = bindTypertRemote(this, 'xiaobaiConfig')
  }

  async openStore() {
    if (typeof this.workspaceService?.openStore !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Workspace storage service is unavailable', { phase: 'config-storage' })
    return this.workspaceService.openStore()
  }

  async workspaceFor(request = {}) {
    const workspaceRoot = request.workspaceRoot ?? request.workspacePath ?? (request.workspaceBindingRef ? this.bindingPath(undefined, request.workspaceBindingRef) : undefined)
    let workspace
    if (workspaceRoot) workspace = await this.workspaceService.load({ workspaceRoot, workspaceTitle: request.workspaceTitle, mode: request.mode })
    else if (this.workspaceService.current && request.refresh !== false && typeof this.workspaceService.load === 'function') workspace = await this.workspaceService.load({ workspaceRoot: this.workspaceService.current.workspaceRoot, mode: 'reload' })
    else workspace = this.workspaceService.current
    if (!workspace) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Select or load an explicit Workspace before configuration operations', { phase: 'config-workspace' })
    if (request.workspaceId && request.workspaceId !== workspace.workspaceId) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'The requested Workspace does not match the loaded Workspace', { phase: 'config-workspace' })
    return workspace
  }

  projectEntry(workspace, projectId) {
    if (typeof projectId !== 'string' || projectId.length === 0) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, 'A Project id is required', { phase: 'config-project' })
    const entry = workspace.projects.find((candidate) => candidate.baseline?.projectId === projectId || candidate.projectId === projectId)
    if (!entry) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${projectId}' is not registered in this Workspace`, { resourceId: projectId, phase: 'config-project' })
    return entry.baseline ? entry : { ...entry, baseline: entry.baseline }
  }

  projectGroup(workspace, groupId) {
    if (typeof groupId !== 'string' || groupId.length === 0) {
      throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'A parent ProjectGroup id is required for child Project creation', { phase: 'config-project' })
    }
    const group = (workspace.projectGroups ?? []).find((candidate) => candidate.id === groupId || candidate.name === groupId)
    if (!group || !group.sourceConfig?.children || !group.projectRoot) {
      throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `ProjectGroup '${groupId}' is not registered for child Project creation`, { resourceId: groupId, phase: 'config-project' })
    }
    return group
  }

  async currentState(workspace, projectId, store) {
    const entry = this.projectEntry(workspace, projectId)
    const config = baselineToConfig(entry)
    const revisions = store.listRevisions(workspace.workspaceId, projectId)
    const latest = revisions[0]
    const digest = latest?.digest ?? sha256Digest(config)
    const revision = latest?.revision ?? shortResource('rev', { workspaceId: workspace.workspaceId, projectId, digest })
    const sourceDigest = entry.configDigest
    const drift = Boolean(latest?.sourceDigest && sourceDigest && latest.sourceDigest !== sourceDigest)
    return { entry, config, digest, revision, latest, sourceDigest, drift }
  }

  async projectCandidates(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor({ ...request, refresh: false })
      const query = String(request.query ?? '').trim().toLowerCase()
      const projects = workspace.projects
        .map((entry) => {
          const projectId = entry.baseline?.projectId ?? entry.projectId
          const sourceProjectId = safeCandidateText(entry.sourceProjectId ?? entry.baseline?.key, projectId)
          const displayName = safeCandidateText(entry.baseline?.displayName ?? entry.displayName, sourceProjectId)
          const repositoryStatuses = Array.isArray(entry.repositoryStatuses) ? entry.repositoryStatuses : []
          const repositoryStatus = repositoryStatuses.length === 0
            ? 'unknown'
            : repositoryStatuses.every((repository) => repository.status === 'locked')
              ? 'locked'
              : repositoryStatuses.some((repository) => repository.status === 'unavailable')
                ? 'unavailable'
                : 'unknown'
          return {
            workspaceId: workspace.workspaceId,
            projectId,
            sourceProjectId,
            displayName,
            status: entry.status ?? workspace.status,
            knowledgeStatus: entry.knowledgeStatus ?? 'unknown',
            repositoryStatus,
          }
        })
        .filter((project) => query.length === 0 || [project.sourceProjectId, project.displayName, project.projectId].some((value) => String(value).toLowerCase().includes(query)))
      return envelope('ok', { workspaceId: workspace.workspaceId, projects })
    })
  }

  async list(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const diagnostics = redactLoadedWorkspace(workspace).diagnostics
      const projects = workspace.projects.map((entry) => {
        const projectId = entry.baseline?.projectId ?? entry.projectId
        const config = entry.baseline ? baselineToConfig(entry) : undefined
        const revisions = store.listRevisions(workspace.workspaceId, projectId)
        const latest = revisions[0]
        return {
          projectId,
          displayName: entry.baseline?.displayName ?? entry.displayName,
          owner: entry.baseline?.owner ?? entry.owner,
          classification: entry.baseline?.classification ?? entry.classification,
          status: entry.status ?? workspace.status,
          revision: latest?.revision ?? shortResource('rev', { workspaceId: workspace.workspaceId, projectId, digest: latest?.digest ?? sha256Digest(config) }),
          digest: latest?.digest ?? sha256Digest(config),
          configLocator: `projects/${safeKey(entry.sourceProjectId ?? config?.key, 'project')}/.loop/project.yaml`,
          pathBindingDigest: entry.pathBindingDigest,
          knowledgeStatus: entry.knowledgeStatus,
          repositoryStatuses: entry.repositoryStatuses,
        }
      })
      return envelope('ok', { workspaceId: workspace.workspaceId, title: workspace.title, status: workspace.status, projects, diagnostics }, diagnostics)
    })
  }

  async get(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const state = await this.currentState(workspace, request.projectId, store)
      return envelope('ok', {
        workspaceId: workspace.workspaceId,
        projectId: request.projectId,
        revision: state.revision,
        digest: state.digest,
        config: state.config,
        status: workspace.status,
      })
    })
  }

  async createDraft(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      let config = request.config
      let projectId = request.projectId
      let current
      if (projectId) {
        current = await this.currentState(workspace, projectId, store)
        config = isObject(config) ? { ...current.config, ...config } : current.config
      }
      if (!isObject(config)) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'A structured Project configuration is required', { phase: 'config-draft' })
      config = cloneCanonical(config)
      const operation = request.operation ?? (request.projectId ? 'update' : 'create')
      if (operation === 'update' && !request.projectId) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'Update drafts require an existing Project id', { phase: 'config-draft' })
      if (operation === 'create' && request.projectId) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'Create drafts cannot include an existing Project id', { phase: 'config-draft' })
      if (current && config.key !== current.config.key) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'Project identity key cannot change during an update; create a new Project instead', { resourceId: projectId, phase: 'config-draft' })
      if (config.parentGroupId) {
        const group = this.projectGroup(workspace, config.parentGroupId)
        if (current?.parentGroupId && current.parentGroupId !== config.parentGroupId) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'A child Project cannot move between ProjectGroups during an update', { resourceId: projectId, phase: 'config-draft' })
        if (!current && workspace.projects.some((entry) => entry.parentGroupId === config.parentGroupId && entry.baseline?.key === config.key)) {
          throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, `Project key '${config.key}' already exists in ProjectGroup '${config.parentGroupId}'`, { resourceId: config.parentGroupId, phase: 'config-draft' })
        }
      } else if (current?.parentGroupId) {
        config.parentGroupId = current.parentGroupId
        config.sharedContextId = current.sharedContextId
      }
      projectId = projectId ?? projectIdFor(workspace.workspaceId, config)
      const existing = workspace.projects.some((entry) => entry.baseline?.projectId === projectId)
      if (operation === 'create' && existing) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'A Project with this identity already exists', { resourceId: projectId, phase: 'config-draft' })
      let baseRevision = request.baseRevision
      let baseDigest = request.baseDigest
      if (!baseRevision || !baseDigest) {
        if (request.projectId) {
          baseRevision = current.revision
          baseDigest = current.digest
        } else {
          baseDigest = sha256Digest({ workspaceId: workspace.workspaceId, projectId: null, key: config.key })
          baseRevision = shortResource('rev', { workspaceId: workspace.workspaceId, key: config.key, empty: true })
        }
      }
      const draft = validateContract('projectConfigDraft', {
        schemaVersion: CONFIG_CONTRACT_VERSION,
        draftId: resourceId('drf'),
        workspaceId: workspace.workspaceId,
        ...(operation === 'update' ? { projectId } : {}),
        operation,
        baseRevision,
        baseDigest,
        actor: { identity: String(request.actor?.identity ?? request.actor ?? 'dsh-user') },
        config,
        createdAt: new Date().toISOString(),
      })
      await store.saveDraft(draft)
      return envelope('ok', draft)
    })
  }

  validateConfig(draft, workspace) {
    const diagnostics = []
    let baseline
    try { baseline = configToBaseline(draft.config, workspace.workspaceId, draft.projectId) } catch (error) { diagnostics.push(diagnostic(error, ERROR_CODES.CONFIG_INVALID, 'config')) }
    if (draft.operation === 'update' && !draft.projectId) diagnostics.push({ code: ERROR_CODES.CONFIG_INVALID, severity: 'error', field: 'projectId', message: 'Update drafts require a Project id.', phase: 'config-validation' })
    if (draft.operation === 'create' && draft.projectId) diagnostics.push({ code: ERROR_CODES.CONFIG_INVALID, severity: 'error', field: 'projectId', message: 'Create drafts must not reuse an existing Project id.', phase: 'config-validation' })
    if (draft.config.parentGroupId) {
      try {
        const group = this.projectGroup(workspace, draft.config.parentGroupId)
        if (!draft.config.sharedContextId && group.sharedContextId) draft.config.sharedContextId = group.sharedContextId
      } catch (error) {
        diagnostics.push(diagnostic(error, ERROR_CODES.CONFIG_INVALID, 'parentGroupId'))
      }
    }
    return { baseline, diagnostics }
  }

  async validate(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const draft = validateContract('projectConfigDraft', request.draft ?? request)
      const validation = this.validateConfig(draft, workspace)
      let state
      if (draft.operation === 'update' && draft.projectId) state = await this.currentState(workspace, draft.projectId, store)
      const currentDigest = state?.digest ?? sha256Digest({ workspaceId: workspace.workspaceId, projectId: null, key: draft.config.key })
      const currentRevision = state?.revision ?? shortResource('rev', { workspaceId: workspace.workspaceId, key: draft.config.key, empty: true })
      if (draft.baseDigest !== currentDigest || draft.baseRevision !== currentRevision) validation.diagnostics.push({ code: ERROR_CODES.CONFIG_CONFLICT, severity: 'error', message: 'The draft baseline is stale; reload the Project before applying changes.', phase: 'config-validation' })
      if (state?.drift) validation.diagnostics.push({ code: ERROR_CODES.CONFIG_DRIFT, severity: 'error', message: 'The Project files changed outside the recorded configuration revision; reload and reconcile before applying changes.', phase: 'config-validation' })
      const status = validation.diagnostics.some((item) => item.severity === 'error') ? 'invalid' : 'ok'
      return envelope(status, { draftId: draft.draftId, projectId: draft.projectId ?? projectIdFor(workspace.workspaceId, draft.config), valid: status === 'ok', diagnostics: validation.diagnostics }, validation.diagnostics)
    })
  }

  bindingPath(entry, bindingRef) {
    const direct = safeLocalBinding(this.bindings.get(bindingRef))
    if (direct) return direct
    const persisted = entry?.localBindings?.[bindingRef]
    if (safeLocalBinding(persisted)) return safeLocalBinding(persisted)
    if (entry?.background?.bindingRef === bindingRef) return safeLocalBinding(entry.background.localPath)
    return undefined
  }

  bindingValue(entry, bindingRef) {
    if (this.bindings.has(bindingRef)) return this.bindings.get(bindingRef)
    if (entry?.localBindings?.[bindingRef]) return entry.localBindings[bindingRef]
    if (entry?.background?.bindingRef === bindingRef) return { path: entry.background.localPath, approvedRoots: entry.background.approvedRoots }
    const repositoryBinding = entry?.localPaths?.repositories?.[bindingRef]
    if (repositoryBinding) return repositoryBinding
    const backgroundBinding = entry?.localPaths?.background?.[bindingRef]
    if (backgroundBinding) return backgroundBinding
    return undefined
  }

  async resolveBinding(entry, bindingRef, field) {
    const binding = localBinding(this.bindingValue(entry, bindingRef))
    if (!binding) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, `Select a Host directory for '${bindingRef}' before previewing this configuration`, { phase: 'config-local-binding', resourceId: bindingRef })
    let canonical
    try {
      canonical = await realpath(binding.path)
      const info = await stat(canonical)
      if (!info.isDirectory()) throw new Error('Selected binding is not a directory')
      const roots = await Promise.all(binding.approvedRoots.map((root) => realpath(root)))
      if (!roots.some((root) => pathWithinRoot(canonical, root))) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Binding '${bindingRef}' escapes its approved Host roots`, { phase: 'config-local-binding', resourceId: bindingRef })
    } catch (error) {
      if (error instanceof XiaobaiError) throw error
      throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, `Host directory binding '${bindingRef}' is unavailable; select it again`, { phase: 'config-local-binding', resourceId: field ?? bindingRef, cause: error })
    }
    return canonical
  }

  async materializeFiles(workspace, draft, state) {
    const projectId = draft.projectId ?? projectIdFor(workspace.workspaceId, draft.config)
    const parentGroupId = state?.entry?.parentGroupId ?? draft.config.parentGroupId
    const group = parentGroupId ? this.projectGroup(workspace, parentGroupId) : undefined
    const projectRoot = assertWorkspacePath(
      workspace.workspaceRoot,
      state?.entry?.projectRoot
        ?? (group ? resolve(group.projectRoot, group.sourceConfig.children.directory, safeKey(draft.config.key)) : resolve(workspace.workspaceRoot, CONFIG_ROOT, safeKey(draft.config.key)))
    )
    const loopRoot = resolve(projectRoot, '.loop')
    const sharedPath = assertWorkspacePath(workspace.workspaceRoot, state?.entry?.configPath ?? resolve(loopRoot, 'project.yaml'))
    const localPath = assertWorkspacePath(workspace.workspaceRoot, group?.localPathsPath ?? resolve(loopRoot, 'local.paths.yaml'))
    await assertSafeWriteTarget(workspace.workspaceRoot, sharedPath)
    const writesInheritedLocalPaths = Boolean(group)
    await assertSafeWriteTarget(workspace.workspaceRoot, localPath)
    const source = sourceProjectConfig(draft.config, {
      parentGroupId,
      sharedContextId: state?.entry?.sharedContextId ?? group?.sharedContextId,
      sourceConfig: state?.entry?.sourceConfig,
    })
    const local = writesInheritedLocalPaths
      ? cloneCanonical(group?.localPaths ?? {})
      : { repositories: {} }
    if (!isObject(local.repositories)) local.repositories = {}
    for (const repository of draft.config.repositories) {
      if (repository.source !== 'local') continue
      const bindingRef = repository.bindingRef ?? repository.repoId ?? shortResource('binding', { key: draft.config.key, name: repository.name, index: draft.config.repositories.indexOf(repository) })
      const path = await this.resolveBinding(state?.entry ?? group, bindingRef, `repositories.${repository.name}`)
      local.repositories[bindingRef] = path
    }
    const knowledge = draft.config.knowledgeBindings[0]
    if (knowledge?.bindingRef) {
      const path = await this.resolveBinding(state?.entry ?? group, knowledge.bindingRef, 'knowledgeBindings.0')
      local.background = { ...(isObject(local.background) ? local.background : {}), [knowledge.bindingRef]: path }
    }
    const files = [{
      locator: relative(workspace.workspaceRoot, sharedPath).split(sep).join('/'),
      path: sharedPath,
      content: YAML.stringify(source),
    }]
    if (Object.keys(local.repositories).length > 0 || local.background) {
      files.push({
        locator: relative(workspace.workspaceRoot, localPath).split(sep).join('/'),
        path: localPath,
        content: YAML.stringify(local),
      })
    }
    const snapshots = await Promise.all(files.map(async (file) => ({ ...file, snapshot: await fileSnapshot(file.path) })))
    return { projectId, projectRoot, files, snapshots, sharedPath, localPath }
  }

  async preparePreview(workspace, draft, store) {
    const validation = this.validateConfig(draft, workspace)
    let state
    if (draft.operation === 'update' && draft.projectId) state = await this.currentState(workspace, draft.projectId, store)
    const projectId = draft.projectId ?? projectIdFor(workspace.workspaceId, draft.config)
    const currentDigest = state?.digest ?? sha256Digest({ workspaceId: workspace.workspaceId, projectId: null, key: draft.config.key })
    const currentRevision = state?.revision ?? shortResource('rev', { workspaceId: workspace.workspaceId, key: draft.config.key, empty: true })
    const diagnostics = [...validation.diagnostics]
    if (draft.operation === 'update' && !state) diagnostics.push({ code: ERROR_CODES.PROJECT_NOT_FOUND, severity: 'error', field: 'projectId', message: 'The Project is not registered in this Workspace.', phase: 'config-preview' })
    if (draft.operation === 'create' && state) diagnostics.push({ code: ERROR_CODES.CONFIG_CONFLICT, severity: 'error', field: 'key', message: 'The Project identity already exists in this Workspace.', phase: 'config-preview' })
    if (draft.baseDigest !== currentDigest || draft.baseRevision !== currentRevision) diagnostics.push({ code: ERROR_CODES.CONFIG_CONFLICT, severity: 'error', message: 'The draft baseline is stale; reload before applying changes.', phase: 'config-preview' })
    if (state?.drift) diagnostics.push({ code: ERROR_CODES.CONFIG_DRIFT, severity: 'error', message: 'The Project files changed outside the recorded configuration revision; reload and reconcile before applying changes.', phase: 'config-preview' })
    let materialized
    if (!diagnostics.some((item) => item.severity === 'error')) {
      try {
        materialized = await this.materializeFiles(workspace, draft, state)
      } catch (error) {
        diagnostics.push(diagnostic(error, ERROR_CODES.CONFIG_INVALID, error?.resourceId ?? 'config'))
      }
    }
    const files = materialized?.files.map((file) => ({ locator: file.locator, operation: state ? 'update' : 'create', beforeDigest: materialized.snapshots.find((item) => item.path === file.path)?.snapshot.digest ?? null, afterDigest: sha256Digest(file.content), changes: [state ? 'configuration content changed' : 'configuration file created'] })) ?? []
    const status = diagnostics.some((item) => item.code === ERROR_CODES.CONFIG_CONFLICT || item.code === ERROR_CODES.CONFIG_DRIFT) ? 'conflict' : diagnostics.some((item) => item.severity === 'error') ? 'invalid' : 'ready'
    const preview = validateContract('projectConfigPreview', {
      schemaVersion: CONFIG_CONTRACT_VERSION,
      previewId: resourceId('ev'),
      draftId: draft.draftId,
      workspaceId: workspace.workspaceId,
      projectId,
      baseRevision: draft.baseRevision,
      baseDigest: draft.baseDigest,
      currentRevision,
      currentDigest,
      status,
      files,
      risks: [
        ...(state ? [{ code: 'XIAOBAI_CONFIG_OVERWRITE', severity: 'warning', message: 'Applying this draft replaces the current shared configuration.' }] : [{ code: 'XIAOBAI_CONFIG_CREATE', severity: 'info', message: 'Applying this draft creates a new Project configuration.' }]),
        { code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'A Host approval is required before configuration files are written.' },
      ],
      approvalRequired: true,
      nextAction: status === 'ready' ? 'Request Host approval, then apply this preview.' : status === 'conflict' ? 'Reload the current Project, resolve the conflict, and preview again.' : 'Fix the diagnostics before requesting approval.',
      diagnostics,
    })
    return { preview, materialized, state }
  }

  async preview(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const draft = validateContract('projectConfigDraft', request.draft ?? request)
      const result = await this.preparePreview(workspace, draft, store)
      return envelope(result.preview.status === 'ready' ? 'ok' : result.preview.status, result.preview, result.preview.diagnostics)
    })
  }

  async pickDirectory(request = {}) {
    return this.safeCall(async () => {
      const picker = getHostService(this.ctx, 'directoryPicker')
      const capability = typeof picker?.capability === 'function' ? picker.capability() : undefined
      const native = capability === 'native' || capability?.kind === 'native' || capability?.type === 'native'
      const browse = capability === 'browse' || capability?.kind === 'browse' || capability?.type === 'browse'
      if (request.selectedPath !== undefined) {
        if (typeof request.selectedPath !== 'string' || !isAbsolute(request.selectedPath)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Directory Picker returned an invalid path', { phase: 'directory-picker' })
        const canonical = await this.resolvePickedDirectory(request.selectedPath)
        const bindingRef = resourceId('binding')
        this.bindings.set(bindingRef, { path: canonical, approvedRoots: [canonical] })
        return envelope('ok', { bindingRef, kind: request.kind, locator: `binding/${sha256Digest(canonical).slice(7, 19)}`, digest: sha256Digest({ path: canonical }), readOnly: false, trust: 'external' })
      }
      if (browse) throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, '当前主机仅支持浏览式目录选择，请在目录浏览器中确认目录', { phase: 'directory-picker' })
      if (!native || typeof capability?.pick !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host native Directory Picker is unavailable', { phase: 'directory-picker' })
      const path = await capability.pick(request.signal ?? new AbortController().signal)
      if (path === null) return envelope('ok', { cancelled: true })
      if (typeof path !== 'string' || !isAbsolute(path)) throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, 'Directory Picker returned an invalid path', { phase: 'directory-picker' })
      const canonical = await this.resolvePickedDirectory(path)
      const bindingRef = resourceId('binding')
      this.bindings.set(bindingRef, { path: canonical, approvedRoots: [canonical] })
      return envelope('ok', { bindingRef, kind: request.kind, locator: `binding/${sha256Digest(canonical).slice(7, 19)}`, digest: sha256Digest({ path: canonical }), readOnly: false, trust: 'external' })
    })
  }

  async resolvePickedDirectory(path) {
    try {
      const canonical = await realpath(path)
      const info = await stat(canonical)
      if (!info.isDirectory()) throw new Error('Directory Picker returned a file')
      return canonical
    } catch (error) {
      if (error instanceof XiaobaiError) throw error
      throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'Directory Picker returned an unavailable directory', { phase: 'directory-picker', cause: error })
    }
  }

  async requestApproval(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const draft = validateContract('projectConfigDraft', request.draft ?? request)
      const result = await this.preparePreview(workspace, draft, store)
      if (result.preview.status !== 'ready') return envelope(result.preview.status, result.preview, result.preview.diagnostics)
      const agent = request.agent
      if (!agent?.session) return envelope('approval_required', { draftId: draft.draftId, previewId: result.preview.previewId, approvalRequired: true, nextAction: 'Run this request inside a live Host Agent turn to create the approval audit pair.' }, [{ code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'Configuration approval requires a live Host Agent turn.', phase: 'config-approval' }], { errorCode: ERROR_CODES.APPROVAL_REQUIRED, phase: 'config-approval' })
      const approval = getHostService(this.ctx, 'approval')
      if (typeof approval?.request !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host approval.request is unavailable', { phase: 'config-approval' })
      const toolName = `xiaobai-config/${draft.projectId ?? projectIdFor(workspace.workspaceId, draft.config)}`
      const startIndex = Array.isArray(agent.session.events) ? agent.session.events.length : 0
      const outcome = await approval.request({ agent, toolName, reason: 'Apply the approved Xiaobai Project configuration.', signal: request.signal })
      const events = Array.isArray(agent.session.events) ? agent.session.events.slice(startIndex) : []
      const decided = [...events].findLast((event) => event.type === 'approval/decided' && event.data?.outcome === outcome)
      const asked = decided ? events.find((event) => event.type === 'approval/asked' && event.data?.id === decided.data?.id && event.data?.toolName === toolName) : undefined
      if (!asked || !decided) throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, 'Host approval returned without a complete approval audit pair', { phase: 'config-approval' })
      const record = {
        approvalId: resourceId('ev'),
        workspaceId: workspace.workspaceId,
        projectId: draft.projectId ?? projectIdFor(workspace.workspaceId, draft.config),
        draftId: draft.draftId,
        inputDigest: sha256Digest(draft),
        outcome,
        requestId: decided.data?.id,
        asked: true,
        decided: true,
        createdAt: new Date().toISOString(),
      }
      await store.saveApproval(record)
      const status = outcome === 'allowed-once' ? 'ok' : 'approval_required'
      return envelope(status, { approvalId: record.approvalId, outcome, draftId: draft.draftId, requestedAt: record.createdAt }, status === 'ok' ? [] : [{ code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'The Host approval did not allow this configuration write.', phase: 'config-approval' }], { ...(status === 'ok' ? {} : { errorCode: ERROR_CODES.APPROVAL_REQUIRED, phase: 'config-approval' }) })
    })
  }

  async apply(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const draft = request.draft ? validateContract('projectConfigDraft', request.draft) : store.getDraft(request.draftId)
      if (!draft) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'The configuration draft was not found', { phase: 'config-apply' })
      const result = await this.preparePreview(workspace, draft, store)
      const projectId = result.preview.projectId
      const evidenceRef = `workspace/${workspace.workspaceId}/config/${draft.draftId}`
      if (result.preview.status !== 'ready') {
        return envelope(result.preview.status, { schemaVersion: CONFIG_CONTRACT_VERSION, applyId: resourceId('ev'), workspaceId: workspace.workspaceId, projectId, revision: result.preview.currentRevision, digest: result.preview.currentDigest, status: result.preview.status, evidenceRef, diagnostics: result.preview.diagnostics }, result.preview.diagnostics, { errorCode: result.preview.status === 'conflict' ? ERROR_CODES.CONFIG_CONFLICT : ERROR_CODES.CONFIG_INVALID, phase: 'config-apply', resourceId: projectId, evidenceRef })
      }
      const approval = request.approvalId ? store.getApproval(request.approvalId) : undefined
      if (!approval || approval.workspaceId !== workspace.workspaceId || approval.projectId !== projectId || approval.draftId !== draft.draftId || approval.inputDigest !== sha256Digest(draft) || approval.outcome !== 'allowed-once' || approval.asked !== true || approval.decided !== true) {
        return envelope('approval_required', { schemaVersion: CONFIG_CONTRACT_VERSION, applyId: resourceId('ev'), workspaceId: workspace.workspaceId, projectId, revision: result.preview.currentRevision, digest: result.preview.currentDigest, status: 'approval_required', evidenceRef, diagnostics: [{ code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'A fresh Host approval pair is required for this exact draft.', phase: 'config-apply' }] }, [{ code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'A fresh Host approval pair is required for this exact draft.', phase: 'config-apply' }], { errorCode: ERROR_CODES.APPROVAL_REQUIRED, phase: 'config-apply', resourceId: projectId, evidenceRef })
      }
      const materialized = result.materialized
      const snapshots = await atomicWriteSet(materialized.files)
      const previousRevision = result.state?.revision ?? result.preview.currentRevision
      const digest = sha256Digest(draft.config)
      const revision = shortResource('rev', { workspaceId: workspace.workspaceId, projectId, digest, previousRevision })
      const historyId = resourceId('ev')
      const now = new Date().toISOString()
      try {
        const reloaded = await this.workspaceService.load({ workspaceRoot: workspace.workspaceRoot, mode: 'reload' })
        const history = validateContract('configHistoryEntry', { schemaVersion: CONFIG_CONTRACT_VERSION, historyId, revision, workspaceId: workspace.workspaceId, projectId, parentRevision: previousRevision, digest, operation: request.historyOperation ?? draft.operation, actor: draft.actor.identity, status: 'applied', createdAt: now, evidenceRef, changedFiles: materialized.files.map((file) => file.locator), canRollback: true })
        await store.saveRevision({ schemaVersion: CONFIG_CONTRACT_VERSION, workspaceId: workspace.workspaceId, projectId, revision, parentRevision: previousRevision, digest, sourceDigest: reloaded.projects.find((entry) => entry.baseline?.projectId === projectId)?.configDigest, config: draft.config, changedFiles: history.changedFiles, createdAt: now, operation: draft.operation, actor: draft.actor.identity, historyId })
        await store.recordConfigAudit({ auditId: historyId, workspaceId: workspace.workspaceId, projectId, event: 'workspace.config.changed', revision, digest, actor: draft.actor.identity, createdAt: now, evidenceRef })
      } catch (error) {
        for (const snapshot of snapshots) await restoreSnapshot(snapshot.path, snapshot.snapshot)
        try { await this.workspaceService.load({ workspaceRoot: workspace.workspaceRoot, mode: 'reload' }) } catch (reloadError) { error.reloadError = reloadError }
        try { await store.recordConfigAudit({ auditId: `${historyId}-failed`, workspaceId: workspace.workspaceId, projectId, event: 'workspace.config.apply.failed', revision, digest, actor: draft.actor.identity, createdAt: new Date().toISOString(), evidenceRef, errorCode: error.code ?? ERROR_CODES.WRITE_FAILED }) } catch { /* Preserve the primary write failure. */ }
        throw new XiaobaiError(ERROR_CODES.WRITE_FAILED, `Configuration persistence failed: ${error.message ?? String(error)}`, { phase: 'config-apply-persistence', resourceId: projectId, evidenceRef, cause: error })
      }
      if (typeof this.ctx?.emit === 'function') this.ctx.emit('workspace.config.changed', { workspaceId: workspace.workspaceId, projectId, revision, digest, evidenceRef })
      const applied = validateContract('projectConfigApplyResult', { schemaVersion: CONFIG_CONTRACT_VERSION, applyId: resourceId('ev'), workspaceId: workspace.workspaceId, projectId, revision, digest, status: 'applied', historyId, evidenceRef, diagnostics: [] })
      return envelope('ok', applied)
    })
  }

  async history(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      this.projectEntry(workspace, request.projectId)
      const entries = store.listRevisions(workspace.workspaceId, request.projectId).map((revision) => validateContract('configHistoryEntry', {
        schemaVersion: CONFIG_CONTRACT_VERSION,
        historyId: revision.historyId ?? shortResource('ev', { revision: revision.revision, history: true }),
        revision: revision.revision,
        workspaceId: revision.workspaceId,
        projectId: revision.projectId,
        parentRevision: revision.parentRevision ?? null,
        digest: revision.digest,
        operation: revision.operation,
        actor: revision.actor,
        status: 'applied',
        createdAt: revision.createdAt,
        evidenceRef: `workspace/${revision.workspaceId}/config/${revision.revision}`,
        changedFiles: revision.changedFiles,
        canRollback: true,
      }))
      return envelope('ok', { workspaceId: workspace.workspaceId, projectId: request.projectId, entries })
    })
  }

  async rollback(request = {}) {
    return this.safeCall(async () => {
      const workspace = await this.workspaceFor(request)
      const store = await this.openStore()
      const target = store.getRevision(workspace.workspaceId, request.projectId, request.revision)
      if (!target) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'Rollback target is not a recorded configuration revision', { phase: 'config-rollback' })
      let draft = request.draftId ? store.getDraft(request.draftId) : undefined
      if (draft) draft = validateContract('projectConfigDraft', draft)
      if (draft && (draft.workspaceId !== workspace.workspaceId || draft.projectId !== request.projectId || sha256Digest(draft.config) !== sha256Digest(target.config))) throw new XiaobaiError(ERROR_CODES.CONFIG_CONFLICT, 'Rollback draft does not match the recorded target revision', { phase: 'config-rollback', resourceId: request.revision })
      if (!draft) {
        const state = await this.currentState(workspace, request.projectId, store)
        draft = validateContract('projectConfigDraft', { schemaVersion: CONFIG_CONTRACT_VERSION, draftId: resourceId('drf'), workspaceId: workspace.workspaceId, projectId: request.projectId, operation: 'update', baseRevision: state.revision, baseDigest: state.digest, actor: { identity: String(request.actor?.identity ?? request.actor ?? 'dsh-user') }, config: target.config, createdAt: new Date().toISOString() })
        await store.saveDraft(draft)
      }
      if (!request.approvalId) return envelope('approval_required', { draftId: draft.draftId, draft, targetRevision: request.revision, nextAction: 'Request approval for the rollback draft, then retry rollback.' }, [{ code: ERROR_CODES.APPROVAL_REQUIRED, severity: 'warning', message: 'Rollback requires a fresh Host approval pair.', phase: 'config-rollback' }], { errorCode: ERROR_CODES.APPROVAL_REQUIRED, phase: 'config-rollback' })
      return this.apply({ ...request, draft, approvalId: request.approvalId, historyOperation: 'rollback' })
    })
  }

  async safeCall(operation) {
    try { return await operation() } catch (error) { return failureEnvelope(error) }
  }
}

export { baselineToConfig, configToBaseline, redactText }
