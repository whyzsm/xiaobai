import { createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import { ERROR_CODES } from './constants.js'
import { assessProjectBaseline, bootstrapProjectBaseline, validateProjectBaseline } from './contracts.js'
import { XiaobaiError, scopeRequired } from './errors.js'
import { requireHostService } from './host.js'
import { resolveRepositoryBinding } from './path-binding.js'
import { sha256Digest } from './canonical.js'

function canonicalWorkspaceId(workspace) {
  if (typeof workspace?.id !== 'string' || workspace.id.length === 0) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Host Workspace must provide a non-empty id', { phase: 'workspace-resolution' })
  if (/^ws_[a-z0-9][a-z0-9_-]{2,63}$/.test(workspace.id)) return workspace.id
  return `ws_${sha256Digest({ hostWorkspaceId: workspace.id, path: workspace.path }).slice(7, 19)}`
}

export class ProjectRegistry {
  constructor(hostContext, options = {}) {
    this.hostContext = hostContext
    this.scopeFactory = options.scopeFactory ?? createScope
    this.scopeReader = options.scopeReader ?? scopeOf
    this.workspace = undefined
    this.projects = new Map()
    this.runPath = options.runPath
    this.gatePolicy = options.gatePolicy
  }

  async attachWorkspace(path, title) {
    const registry = requireHostService(this.hostContext, 'workspaceRegistry', 'create')
    const workspace = await registry.create(path, title)
    this.workspace = { id: canonicalWorkspaceId(workspace), hostId: workspace.id, path: workspace.path, title: workspace.title }
    return this.workspace
  }

  registerBaseline(baseline) {
    const normalized = validateProjectBaseline(baseline)
    if (this.projects.has(normalized.projectId)) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Project '${normalized.projectId}' is already registered`, { resourceId: normalized.projectId, phase: 'project-registration' })
    const scopeKey = Object.freeze({ projectId: normalized.projectId })
    const entry = { baseline: normalized, scopeKey, scope: undefined, scopes: new Map() }
    this.projects.set(normalized.projectId, entry)
    return normalized
  }

  unregisterBaseline(projectId) {
    const entry = this.projects.get(projectId)
    if (!entry) return false
    if (entry.scopes.size > 0) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, `Project '${projectId}' must be closed before unregistering its baseline`, { resourceId: projectId, phase: 'project-registration' })
    return this.projects.delete(projectId)
  }

  bootstrapBaseline(input, options = {}) {
    const baseline = bootstrapProjectBaseline(input)
    if (options.workspacePath) return this.attachWorkspace(options.workspacePath, options.workspaceTitle).then(() => this.registerBaseline(baseline))
    return this.registerBaseline(baseline)
  }

  assessBaseline(value) {
    return assessProjectBaseline(value)
  }

  get(projectId) {
    return this.projects.get(projectId)?.baseline
  }

  list() {
    return [...this.projects.values()].map((entry) => entry.baseline)
  }

  openProject(projectId, options = {}) {
    const entry = this.projects.get(projectId)
    if (!entry) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${projectId}' is not registered`, { resourceId: projectId, phase: 'project-resolution', remediation: 'Register a validated project baseline first.' })
    const baseCtx = options.context ?? options.ctx ?? this.hostContext
    const existing = entry.scopes.get(baseCtx)
    if (existing) return this.projectHandle(entry, existing)
    const parentScopeKey = options.parentScopeKey ?? this.scopeReader(baseCtx)
    const scopeKey = Object.freeze({ projectId: entry.baseline.projectId, parentScopeKey: parentScopeKey && typeof parentScopeKey === 'object' ? parentScopeKey : undefined })
    const scopeOptions = parentScopeKey && typeof parentScopeKey === 'object' ? { parent: parentScopeKey } : {}
    const scope = this.scopeFactory(baseCtx, scopeKey, scopeOptions)
    const owned = { baseCtx, scopeKey, scope }
    entry.scopes.set(baseCtx, owned)
    if (!entry.scope) entry.scope = owned
    return this.projectHandle(entry, owned)
  }

  openProjectForAgent(projectId, agent) {
    if (!agent || !agent.ctx || typeof agent.id !== 'string') throw scopeRequired(projectId, 'agent-scope-bridge')
    if (agent.status !== undefined && !['idle', 'running'].includes(agent.status)) throw scopeRequired(projectId, 'agent-scope-bridge')
    let scopedAgent
    if (typeof agent.ctx.get === 'function') {
      try { scopedAgent = agent.ctx.get('agent') } catch { scopedAgent = undefined }
    }
    if (scopedAgent !== undefined && scopedAgent !== agent) throw scopeRequired(projectId, 'agent-scope-bridge')
    return this.openProject(projectId, { context: agent.ctx })
  }

  closeProject(projectId, context) {
    const entry = this.projects.get(projectId)
    if (!entry || entry.scopes.size === 0) return Promise.resolve()
    const owned = context
      ? entry.scopes.get(context) ?? [...entry.scopes.values()].find((candidate) => candidate.scope.ctx === context)
      : undefined
    const targets = owned ? [owned] : [...entry.scopes.values()]
    for (const target of targets) entry.scopes.delete(target.baseCtx)
    if (entry.scope && targets.includes(entry.scope)) entry.scope = undefined
    return Promise.all(targets.map((target) => target.scope.dispose())).then(() => undefined)
  }

  assertProjectContext(projectId, ctx) {
    const entry = this.projects.get(projectId)
    if (!entry) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${projectId}' is not registered`, { resourceId: projectId, phase: 'scope-check' })
    const owned = [...entry.scopes.values()].find((candidate) => candidate.scope.ctx === ctx)
    if (!owned || owned.scope.ctx !== ctx || this.scopeReader(ctx) !== owned.scopeKey) throw scopeRequired(projectId, 'scope-check')
    return entry.baseline
  }

  assertSameProject(leftProjectId, rightProjectId) {
    if (leftProjectId !== rightProjectId) throw new XiaobaiError(ERROR_CODES.CAPABILITY_DENIED, `Cross-project access from '${leftProjectId}' to '${rightProjectId}' is denied`, { phase: 'scope-check', expected: leftProjectId, actual: rightProjectId, remediation: 'Use an explicit read-only shared Knowledge binding.' })
  }

  resolveRepository(projectId, repositoryId, options = {}) {
    const project = this.get(projectId)
    if (!project) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${projectId}' is not registered`, { resourceId: projectId, phase: 'repository-resolution' })
    if (!this.workspace?.path) throw scopeRequired(projectId, 'workspace-resolution')
    return resolveRepositoryBinding({ project, repositoryId, workspacePath: options.workspacePath ?? this.workspace.path, localBindings: options.localBindings, worktreeId: options.worktreeId })
  }

  run(input = {}) {
    if (typeof this.runPath !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Project run service is not configured', { phase: 'project-run' })
    if (!input.agent || input.agent.status !== 'running') throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'project-run must execute inside an open Host Agent turn', { phase: 'project-run', remediation: 'Invoke the domain run from an Agent turn; a standalone human command only admits the request.' })
    const { agent, projectId, ...options } = input
    if (projectId !== undefined && !this.get(projectId)) throw new XiaobaiError(ERROR_CODES.PROJECT_NOT_FOUND, `Project '${projectId}' is not registered`, { resourceId: projectId, phase: 'project-run' })
    const projects = options.projects ?? (projectId === undefined ? undefined : [this.get(projectId)])
    return this.runPath({ ...options, ...(projects === undefined ? {} : { projects }), workspacePath: options.workspacePath ?? this.workspace?.path, ctx: this.hostContext, agent, projectRegistry: this, gatePolicy: this.gatePolicy })
  }

  projectHandle(entry, owned) {
    return { project: entry.baseline, scopeKey: owned.scopeKey, ctx: owned.scope.ctx, dispose: owned.scope.dispose }
  }
}

export function projectIdFromScope(projectRegistry, ctx) {
  for (const entry of projectRegistry.projects.values()) if ([...entry.scopes.values()].some((owned) => owned.scope.ctx === ctx)) return entry.baseline.projectId
  throw scopeRequired(undefined, 'scope-resolution')
}
