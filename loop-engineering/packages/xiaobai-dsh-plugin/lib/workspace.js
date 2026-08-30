import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import YAML from 'yaml'
import { ERROR_CODES, ID_PATTERNS } from './constants.js'
import { sha256Digest } from './canonical.js'
import { bootstrapProjectBaseline, validateProjectBaseline } from './contracts.js'
import { XiaobaiError } from './errors.js'
import { WorkspaceRegistryStore } from './storage.js'

const DEFAULT_OWNER = 'workspace-owner'
const DEFAULT_CLASSIFICATION = 'internal'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'))
}

function expandHome(value) {
  return value.replace(/^~(?=$|[/\\])/, process.env.HOME ?? '')
}

function localPathValue(section, key, basePath) {
  const value = section?.[key]
  const raw = typeof value === 'string' ? value : value?.path
  if (typeof raw !== 'string' || raw.length === 0) return undefined
  return {
    path: isAbsolute(expandHome(raw)) ? resolve(expandHome(raw)) : resolve(basePath, expandHome(raw)),
    approvedRoots: Array.isArray(value?.approvedRoots)
      ? value.approvedRoots.map((root) => isAbsolute(expandHome(root)) ? resolve(expandHome(root)) : resolve(basePath, expandHome(root)))
      : [isAbsolute(expandHome(raw)) ? resolve(expandHome(raw)) : resolve(basePath, expandHome(raw))],
  }
}

function safeKey(value, fallback) {
  const normalized = String(value ?? fallback).toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const compact = normalized.replace(/-+/g, '-').replace(/^-|-$/g, '')
  return ID_PATTERNS.key.test(compact) ? compact : fallback
}

function projectDigest(sourceProjectId) {
  // Project identity must survive moving the Host Workspace to another machine.
  return sha256Digest({ sourceProjectId }).slice(7, 19)
}

function resourceDigest(value) {
  return sha256Digest(value).slice(7, 19)
}

function sourcePath(projectRoot, relativePath) {
  const candidate = resolve(projectRoot, relativePath)
  const relation = relative(projectRoot, candidate)
  if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) {
    throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Project source path '${relativePath}' escapes project root`, { phase: 'workspace-config-path', actual: candidate, expected: projectRoot })
  }
  return candidate
}

function baselineForProject(project, projectRoot, workspaceRoot, localPaths) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'ProjectGroup configuration must be an object', { phase: 'workspace-config' })
  }
  const sourceProjectId = typeof project.id === 'string' && project.id.length > 0 ? project.id : projectRoot.split(sep).at(-1)
  const key = safeKey(sourceProjectId, 'project')
  const digest = projectDigest(sourceProjectId)
  const owner = typeof project.owner === 'string' && project.owner.length > 0 ? project.owner : DEFAULT_OWNER
  const classification = ['public', 'internal', 'confidential', 'restricted'].includes(project.classification)
    ? project.classification
    : DEFAULT_CLASSIFICATION
  const repositories = Array.isArray(project.repositories) ? project.repositories : []
  if (repositories.length === 0) {
    throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Project '${sourceProjectId}' has no repositories`, { phase: 'workspace-config', resourceId: sourceProjectId })
  }

  const localBindings = {}
  const repositoryBindings = repositories.map((repository, index) => {
    const repositoryKey = safeKey(repository?.id ?? repository?.name, `repository-${index + 1}`)
    const repositoryDigest = resourceDigest({ sourceProjectId, repositoryId: repository?.id ?? repositoryKey })
    const local = localPathValue(localPaths?.repositories, repository?.localPathKey ?? repository?.id ?? repository?.name, workspaceRoot)
    const declaredMount = typeof repository?.mount === 'string' && repository.mount.length > 0
      ? repository.mount
      : `repositories/${repositoryKey}`
    const mountPath = resolve(projectRoot, declaredMount)
    const binding = local ?? (declaredMount ? { path: mountPath, approvedRoots: [mountPath] } : undefined)
    if (binding) {
      localBindings[`repo_${repositoryDigest}`] = {
        path: binding.path,
        ...(binding.approvedRoots ? { approvedRoots: binding.approvedRoots } : {}),
      }
    }
    return {
      repoId: `repo_${repositoryDigest}`,
      name: String(repository?.name ?? repositoryKey),
      root: `repositories/${repositoryKey}`,
      pathTemplate: `repositories/${repositoryKey}`,
      source: local ? 'local' : 'mount',
      readOnly: repository?.readOnly === true,
      owner,
      classification,
      worktrees: [],
    }
  })

  const background = project.background
  const backgroundLocal = background
    ? localPathValue(localPaths?.background, background.localPathKey ?? background.id, workspaceRoot)
    : undefined
  const backgroundMount = background?.mount ? resolve(projectRoot, background.mount) : undefined
  const knowledgeSource = background
    ? `skill-context:${background.id ?? sourceProjectId}`
    : `project:${sourceProjectId}`
  // The shared baseline must be portable; local path changes belong only to
  // pathBindingDigest and must not create a different Knowledge lock.
  const knowledgeDigest = sha256Digest({
    sourceProjectId,
    background: background ? { id: background.id, mount: background.mount, integration: background.integration } : undefined,
  })
  const knowledgeId = `know_${resourceDigest({ sourceProjectId, knowledgeSource })}`
  const skillName = safeKey(`${key}-context`, 'project-context')
  const skillId = `skill_${resourceDigest({ sourceProjectId, skillName })}`
  const profileId = `agent_${resourceDigest({ sourceProjectId, role: 'project-operator' })}`
  const memoryId = `mem_${resourceDigest({ sourceProjectId, memory: true })}`
  const baseline = bootstrapProjectBaseline({
    projectId: `prj_${digest}`,
    key,
    displayName: String(project.name ?? sourceProjectId),
    owner,
    classification,
    repositoryId: repositoryBindings[0].repoId,
    repository: repositoryBindings[0],
    knowledgeId,
    knowledge: {
      source: knowledgeSource,
      scope: `prj_${digest}`,
      revision: background?.integration?.contractVersion ?? 'declared',
      digest: knowledgeDigest,
      readOnly: background ? true : false,
      trust: background ? 'external' : 'project',
      requiredCapabilities: background ? ['knowledge.read'] : [],
    },
    agentRole: 'project-operator',
    agentPurpose: `Operate Project ${sourceProjectId} through an explicit dsh scope`,
    agentId: profileId,
    skillId,
    skillName,
    skillPurpose: `Resolve the explicit ${sourceProjectId} Project context`,
    memoryNamespaceId: memoryId,
    artifactRoot: `artifacts/${key}`,
    qualityCommands: project.qualityCommands,
  })
  const normalized = validateProjectBaseline({
    ...baseline,
    repositories: repositoryBindings,
    knowledgeBindings: [{
      knowledgeId,
      source: knowledgeSource,
      scope: `prj_${digest}`,
      revision: background?.integration?.contractVersion ?? 'declared',
      digest: knowledgeDigest,
      readOnly: background ? true : false,
      trust: background ? 'external' : 'project',
      requiredCapabilities: background ? ['knowledge.read'] : [],
    }],
    agentProfiles: [{
      ...baseline.agentProfiles[0],
      agentId: profileId,
      allowedSkills: [skillId],
    }],
    skills: [{
      ...baseline.skills[0],
      skillId,
      name: skillName,
      owner,
    }],
  })
  return {
    baseline: normalized,
    sourceProjectId,
    projectRoot,
    configPath: sourcePath(projectRoot, '.loop/project.yaml'),
    source: {
      kind: 'project-group',
      id: sourceProjectId,
      revision: 'filesystem',
      digest: sha256Digest({ project, sourceProjectId }),
    },
    localBindings,
    background: background ? {
      id: background.id ?? sourceProjectId,
      declaredMount: backgroundMount,
      localPath: backgroundLocal?.path,
      approvedRoots: backgroundLocal?.approvedRoots,
      integration: background.integration,
    } : undefined,
    configDigest: sha256Digest({ project, sourceProjectId, projectPath: relative(workspaceRoot, projectRoot) }),
    pathBindingDigest: sha256Digest({ repositories: localBindings, background: backgroundLocal?.path }),
  }
}

async function inspectBackground(entry, diagnostics) {
  if (!entry.background) return 'missing'
  const candidate = entry.background.localPath ?? entry.background.declaredMount
  if (!candidate || !(await exists(candidate))) {
    diagnostics.push({ code: 'XIAOBAI_BACKGROUND_UNAVAILABLE', severity: 'warning', projectId: entry.baseline.projectId, sourceProjectId: entry.sourceProjectId, field: 'background', message: 'Background Knowledge mount is unavailable.' })
    return 'unavailable'
  }
  try {
    const canonical = await realpath(candidate)
    const roots = entry.background.approvedRoots ?? [canonical]
    if (!(await Promise.all(roots.map(async (root) => realpath(root)))).some((root) => canonical === root || canonical.startsWith(`${root}${sep}`))) {
      throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Background path '${candidate}' escapes approved roots`, { phase: 'background-path-binding', actual: canonical, expected: roots })
    }
    entry.background.realpath = canonical
    return 'locked'
  } catch (error) {
    diagnostics.push({ code: error.code ?? 'XIAOBAI_BACKGROUND_INVALID', severity: 'error', projectId: entry.baseline.projectId, sourceProjectId: entry.sourceProjectId, field: 'background', message: error.message })
    return 'unavailable'
  }
}

async function inspectRepository(entry, repository, diagnostics) {
  const binding = entry.localBindings[repository.repoId]
  const candidate = binding?.path ?? resolve(entry.projectRoot, repository.pathTemplate)
  if (!(await exists(candidate))) {
    diagnostics.push({ code: 'XIAOBAI_REPOSITORY_UNAVAILABLE', severity: 'warning', projectId: entry.baseline.projectId, sourceProjectId: entry.sourceProjectId, field: `repositories.${repository.name}`, message: 'Repository mount is unavailable.' })
    return { repoId: repository.repoId, status: 'unavailable' }
  }
  try {
    const canonical = await realpath(candidate)
    const roots = binding?.approvedRoots ?? [canonical]
    const realRoots = await Promise.all(roots.map((root) => realpath(root)))
    if (!realRoots.some((root) => canonical === root || canonical.startsWith(`${root}${sep}`))) {
      throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Repository path '${candidate}' escapes approved roots`, { phase: 'repository-path-binding', actual: canonical, expected: realRoots, resourceId: repository.repoId })
    }
    return { repoId: repository.repoId, status: 'locked' }
  } catch (error) {
    diagnostics.push({ code: error.code ?? 'XIAOBAI_REPOSITORY_INVALID', severity: 'error', projectId: entry.baseline.projectId, sourceProjectId: entry.sourceProjectId, field: `repositories.${repository.name}`, message: error.message })
    return { repoId: repository.repoId, status: 'unavailable' }
  }
}

export async function loadWorkspaceConfig(workspaceRoot, options = {}) {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Workspace root is required', { phase: 'workspace-config' })
  let canonicalRoot
  try {
    canonicalRoot = await realpath(resolve(workspaceRoot))
  } catch (error) {
    throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Workspace root '${workspaceRoot}' cannot be resolved`, { phase: 'workspace-config', actual: workspaceRoot, cause: error })
  }
  const projectsRoot = resolve(canonicalRoot, 'projects')
  const diagnostics = []
  if (!(await exists(projectsRoot))) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, `Workspace projects directory is missing: ${projectsRoot}`, { phase: 'workspace-config', actual: projectsRoot })
  const directories = (await readdir(projectsRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
  const projects = []
  for (const directory of directories) {
    const projectRoot = resolve(projectsRoot, directory)
    const configPath = resolve(projectRoot, '.loop/project.yaml')
    if (!(await exists(configPath))) continue
    try {
      const project = await readYaml(configPath)
      const localPathsPath = typeof project?.localPaths === 'string' ? sourcePath(projectRoot, project.localPaths) : resolve(projectRoot, '.loop/local.paths.yaml')
      const localPaths = await exists(localPathsPath) ? await readYaml(localPathsPath) : undefined
      const entry = baselineForProject(project, projectRoot, canonicalRoot, localPaths)
      entry.knowledgeStatus = await inspectBackground(entry, diagnostics)
      entry.repositoryStatuses = await Promise.all(entry.baseline.repositories.map((repository) => inspectRepository(entry, repository, diagnostics)))
      if (entry.localBindings && Object.keys(entry.localBindings).length === 0) {
        diagnostics.push({ code: 'XIAOBAI_LOCAL_PATHS_MISSING', severity: 'warning', projectId: entry.baseline.projectId, sourceProjectId: entry.sourceProjectId, field: 'localPaths', message: 'No local repository path bindings were resolved.' })
      }
      projects.push(entry)
    } catch (error) {
      diagnostics.push({ code: error.code ?? ERROR_CODES.CONFIG_INVALID, severity: 'error', sourceProjectId: directory, field: configPath, message: error.message })
    }
  }
  if (projects.length === 0 && diagnostics.every((diagnostic) => diagnostic.severity !== 'error')) {
    diagnostics.push({ code: 'XIAOBAI_PROJECTS_EMPTY', severity: 'warning', message: 'No ProjectGroup configuration was discovered.' })
  }
  const status = diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    ? 'invalid'
    : diagnostics.length > 0
      ? 'attention'
      : 'loaded'
  return {
    schemaVersion: 'xiaobai.workspace/v1',
    workspaceRoot: canonicalRoot,
    title: options.title ?? canonicalRoot.split(sep).at(-1),
    sourceRevision: options.sourceRevision ?? 'filesystem',
    configDigest: sha256Digest({ projects: projects.map((entry) => entry.configDigest).sort(), sourceRevision: options.sourceRevision ?? 'filesystem' }),
    projects,
    diagnostics,
    status,
  }
}

export function redactLoadedWorkspace(workspace) {
  const diagnosticLocator = (value) => {
    if (typeof value !== 'string' || value.length === 0) return undefined
    if (/^[a-z]:[\\/]/i.test(value) || /^\\\\|^\/\//.test(value)) return undefined
    if (!isAbsolute(value)) return value
    if (!workspace.workspaceRoot) return undefined
    const relation = relative(workspace.workspaceRoot, resolve(value))
    if (relation === '..' || relation.startsWith(`..${sep}`) || isAbsolute(relation)) return undefined
    return relation || '.'
  }
  const diagnosticMessage = (value) => String(value ?? 'Diagnostic')
    .replaceAll(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replaceAll(/(?:[a-z]:[\\/]|\\\\|\/)[^\s'"()<>]+/gi, '[redacted-path]')
    .replaceAll(/((?:token|password|secret|credential))=\S+/gi, '$1=[redacted]')
  return {
    schemaVersion: workspace.schemaVersion,
    workspaceId: workspace.workspaceId,
    title: workspace.title,
    sourceRevision: workspace.sourceRevision,
    configDigest: workspace.configDigest,
    status: workspace.status,
    diagnostics: workspace.diagnostics.map(({ sourceProjectId, projectId, code, severity, field, message }) => ({
      sourceProjectId,
      projectId,
      code,
      severity,
      ...(diagnosticLocator(field) ? { field: diagnosticLocator(field) } : {}),
      message: diagnosticMessage(message),
    })),
    projects: workspace.projects.map((entry) => {
      const repositoryStatuses = entry.repositoryStatuses ?? []
      return {
        projectId: entry.baseline.projectId,
        sourceProjectId: entry.sourceProjectId,
        displayName: entry.baseline.displayName,
        owner: entry.baseline.owner,
        classification: entry.baseline.classification,
        repositoryCount: entry.baseline.repositories.length,
        knowledgeStatus: entry.knowledgeStatus,
        repositoryStatuses,
        mountedRepositoryCount: repositoryStatuses.filter((repository) => repository.status === 'locked').length,
        memoryNamespaceId: entry.baseline.memory.namespaceId,
        baseline: entry.baseline,
        source: entry.source,
        configDigest: entry.configDigest,
        pathBindingDigest: entry.pathBindingDigest,
      }
    }),
  }
}

export class WorkspaceConfigLoader {
  async load(workspaceRoot, options = {}) {
    return loadWorkspaceConfig(workspaceRoot, options)
  }
}

function loadId() {
  return `load_${randomUUID().replaceAll('-', '')}`
}

function finishLoadAttempt(attempt, status, diagnostics) {
  const exitedAt = new Date().toISOString()
  const enteredMs = Date.parse(attempt.enteredAt)
  const exitedMs = Date.parse(exitedAt)
  const durationMs = Number.isFinite(enteredMs) && Number.isFinite(exitedMs) ? Math.max(0, exitedMs - enteredMs) : 0
  return {
    ...attempt,
    status,
    firstActionAt: attempt.enteredAt,
    exitedAt,
    finishedAt: exitedAt,
    durationMs,
    activeMs: durationMs,
    waitingMs: 0,
    waitingReason: 'not-waiting',
    timingSource: 'plugin-clock',
    evidence: [`workspace/${attempt.workspaceId}/load-attempts/${attempt.loadId}`],
    diagnostics,
  }
}

function projectDrift(previousProjects, currentProjects) {
  const previousById = new Map(previousProjects.map((project) => [project.projectId, project]))
  for (const current of currentProjects) {
    const previous = previousById.get(current.baseline.projectId)
    if (!previous) continue
    const previousKnowledge = previous.baseline?.knowledgeBindings?.map((binding) => `${binding.knowledgeId}:${binding.revision}:${binding.digest}`).sort().join('|')
    const currentKnowledge = current.baseline?.knowledgeBindings?.map((binding) => `${binding.knowledgeId}:${binding.revision}:${binding.digest}`).sort().join('|')
    if (previous.configDigest !== current.configDigest) return { previous, current, reason: 'config' }
    if (previous.pathBindingDigest !== current.pathBindingDigest) return { previous, current, reason: 'path-binding' }
    if (previousKnowledge !== currentKnowledge) return { previous, current, reason: 'knowledge-lock' }
  }
  return undefined
}

export class WorkspaceService {
  constructor(ctx, projectRegistry, options = {}) {
    this.ctx = ctx
    this.projectRegistry = projectRegistry
    this.loader = options.loader ?? new WorkspaceConfigLoader()
    this.storeFactory = options.storeFactory ?? WorkspaceRegistryStore.open
    this.store = undefined
    this.current = undefined
  }

  async openStore() {
    if (!this.store) this.store = await this.storeFactory(this.ctx)
    return this.store
  }

  async load(input = {}) {
    const workspaceRoot = input.workspaceRoot ?? input.workspacePath
    if (input.mode === 'recover') return this.recover({ workspaceId: input.workspaceId, workspaceRoot })
    const loaded = await this.loader.load(workspaceRoot, { title: input.workspaceTitle, sourceRevision: input.sourceRevision })
    const hostWorkspace = await this.projectRegistry.attachWorkspace(loaded.workspaceRoot, loaded.title)
    this.projectRegistry.workspace = { ...hostWorkspace, path: loaded.workspaceRoot }
    const workspace = { ...hostWorkspace, path: loaded.workspaceRoot, configDigest: loaded.configDigest, sourceRevision: loaded.sourceRevision, status: loaded.status }
    const store = await this.openStore()
    const previous = store.getWorkspace(workspace.id) ?? store.findWorkspaceByRoot(loaded.workspaceRoot)
    const persistedProjects = typeof store.listProjects === 'function' ? store.listProjects(workspace.id) : []
    const enteredAt = new Date().toISOString()
    const attempt = { loadId: loadId(), workspaceId: workspace.id, mode: input.mode ?? 'load', enteredAt, startedAt: enteredAt, sourceRevision: loaded.sourceRevision, configDigest: loaded.configDigest }
    const drift = previous ? projectDrift(persistedProjects, loaded.projects) : undefined
    const replacementApproved = input.mode === 'reload' || input.mode === 'approve'
    if (previous && previous.configDigest === loaded.configDigest && !drift && this.current?.workspaceId === workspace.id && !replacementApproved) {
      await store.recordLoadAttempt(finishLoadAttempt(attempt, 'loaded', loaded.diagnostics))
      return this.current
    }
    if (previous && (previous.configDigest !== loaded.configDigest || drift) && !replacementApproved) {
      const conflict = {
        conflictId: `conflict_${sha256Digest({ workspaceId: workspace.id, previous: previous.configDigest, current: loaded.configDigest, previousPathBindingDigest: drift?.previous.pathBindingDigest, currentPathBindingDigest: drift?.current.pathBindingDigest }).slice(7, 19)}`,
        workspaceId: workspace.id,
        previousDigest: previous.configDigest,
        currentDigest: loaded.configDigest,
        previousPathBindingDigest: drift?.previous.pathBindingDigest,
        currentPathBindingDigest: drift?.current.pathBindingDigest,
        reason: drift?.reason ?? 'config',
        status: 'unresolved',
        createdAt: new Date().toISOString(),
      }
      await store.recordConflict(conflict)
      loaded.status = 'drift'
      loaded.diagnostics.push({ code: ERROR_CODES.CONFIG_CONFLICT, severity: 'error', message: drift?.reason === 'path-binding' ? 'Workspace local path binding digest differs from the persisted baseline.' : drift?.reason === 'knowledge-lock' ? 'Workspace Knowledge lock differs from the persisted baseline.' : 'Workspace configuration digest differs from the persisted baseline.' })
      await store.recordLoadAttempt(finishLoadAttempt(attempt, 'drift', loaded.diagnostics))
      this.current = {
        ...loaded,
        workspaceId: workspace.id,
        hostWorkspaceId: hostWorkspace.hostId,
        projects: persistedProjects.length > 0 ? persistedProjects.map((project) => ({ ...project, baseline: project.baseline })) : [],
      }
      return this.current
    }
    const registered = []
    const replaced = []
    try {
      for (const entry of loaded.projects) {
        const existing = this.projectRegistry.get(entry.baseline.projectId)
        if (existing) {
          this.projectRegistry.replaceBaseline(entry.baseline)
          replaced.push(existing)
        }
        else {
          this.projectRegistry.registerBaseline(entry.baseline)
          registered.push(entry.baseline.projectId)
        }
      }
      await store.saveWorkspace(workspace, loaded.projects)
      await store.recordLoadAttempt(finishLoadAttempt(attempt, loaded.status, loaded.diagnostics))
    } catch (error) {
      try {
        await store.recordLoadAttempt(finishLoadAttempt(attempt, 'failed', [{ code: error.code ?? ERROR_CODES.CONTRACT_INVALID, severity: 'error', message: error.message ?? String(error) }]))
      } catch {
        // Preserve the primary failure when the storage failure also prevents evidence recording.
      }
      for (const projectId of registered.reverse()) {
        try { this.projectRegistry.unregisterBaseline(projectId) } catch { /* Preserve the storage failure. */ }
      }
      for (const baseline of replaced.reverse()) {
        try { this.projectRegistry.replaceBaseline(baseline) } catch { /* Preserve the storage failure. */ }
      }
      throw error
    }
    this.current = { ...loaded, workspaceId: workspace.id, hostWorkspaceId: hostWorkspace.hostId }
    return this.current
  }

  async recover(input = {}) {
    const store = await this.openStore()
    const canonicalRoot = input.workspaceRoot ? await realpath(resolve(input.workspaceRoot)) : undefined
    const persisted = input.workspaceId
      ? store.getWorkspace(input.workspaceId)
      : canonicalRoot
        ? store.findWorkspaceByRoot(canonicalRoot)
        : undefined
    if (!persisted) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Persisted Workspace was not found; run project-load with an explicit workspaceRoot first', { phase: 'workspace-recovery' })
    const recoveryRoot = canonicalRoot ?? persisted.root
    if (!recoveryRoot) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Workspace recovery requires an explicit workspaceRoot', { phase: 'workspace-recovery', remediation: 'Pass workspaceRoot to project-load with mode recover.' })
    const hostWorkspace = await this.projectRegistry.attachWorkspace(recoveryRoot, persisted.title)
    this.projectRegistry.workspace = { ...hostWorkspace, path: recoveryRoot }
    const projects = store.listProjects(persisted.workspaceId)
    for (const entry of projects) {
      if (this.projectRegistry.get(entry.projectId)) this.projectRegistry.replaceBaseline(entry.baseline)
      else this.projectRegistry.registerBaseline(entry.baseline)
    }
    const recovered = {
      schemaVersion: 'xiaobai.workspace/v1',
      workspaceRoot: recoveryRoot,
      workspaceId: persisted.workspaceId,
      hostWorkspaceId: persisted.hostWorkspaceId,
      title: persisted.title,
      sourceRevision: persisted.sourceRevision,
      configDigest: persisted.configDigest,
      status: persisted.status,
      projects: projects.map((entry) => ({ ...entry, baseline: entry.baseline })),
      diagnostics: [],
    }
    this.current = recovered
    return recovered
  }

  listProjects(input = {}) {
    if (this.current && (!input.workspaceId || input.workspaceId === this.current.workspaceId)) return this.current
    throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Load or recover a Workspace before listing Projects', { phase: 'workspace-list' })
  }

  assessProject(input = {}) {
    const baseline = input.projectId ? this.projectRegistry.get(input.projectId) : input.baseline
    if (!baseline) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${input.projectId ?? 'unknown'}' is not registered`, { phase: 'project-assessment' })
    const loadedEntry = this.current?.projects.find((project) => project.baseline?.projectId === baseline.projectId)
    return {
      projectId: baseline.projectId,
      ...this.projectRegistry.assessBaseline(baseline),
      ...(this.current?.workspaceId ? { workspaceId: this.current.workspaceId } : {}),
      ...(this.current?.status ? { workspaceStatus: this.current.status } : {}),
      ...(loadedEntry?.knowledgeStatus ? { knowledgeStatus: loadedEntry.knowledgeStatus } : {}),
      ...(loadedEntry?.repositoryStatuses ? { repositoryStatuses: loadedEntry.repositoryStatuses } : {}),
      ...(loadedEntry?.configDigest ? { configDigest: loadedEntry.configDigest } : {}),
      diagnostics: (this.current?.diagnostics ?? []).filter((diagnostic) => diagnostic.projectId === baseline.projectId || diagnostic.sourceProjectId === loadedEntry?.sourceProjectId),
    }
  }

  async close() {
    for (const project of this.projectRegistry.list()) await this.projectRegistry.closeProject(project.projectId)
    if (this.store) await this.store.close()
    this.store = undefined
  }
}
