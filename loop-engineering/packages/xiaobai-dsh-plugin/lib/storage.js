import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { relative } from 'node:path'
import { ERROR_CODES } from './constants.js'
import { cloneCanonical, sha256Digest } from './canonical.js'
import { XiaobaiError } from './errors.js'
import { requireHostService } from './host.js'

function objectSchema(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('storage value must be an object')
  return value
}

export const workspaceRegistryDomainSpec = defineDomain({
  name: 'xiaobai_workspace_registry',
  version: 1,
  tables: {
    workspace_records: { valueSchema: { parse: objectSchema } },
    project_baselines: { valueSchema: { parse: objectSchema } },
    load_attempts: { valueSchema: { parse: objectSchema } },
    config_conflicts: { valueSchema: { parse: objectSchema } },
    monitor_projections: { valueSchema: { parse: objectSchema } },
  },
})

function entries(table) {
  return typeof table?.entries === 'function' ? [...table.entries()] : []
}

function persistentBackground(background) {
  if (!background) return undefined
  return {
    id: background.id,
    integration: background.integration,
  }
}

function configLocator(workspacePath, configPath, sourceProjectId) {
  if (typeof workspacePath === 'string' && typeof configPath === 'string') {
    const value = relative(workspacePath, configPath).split('\\').join('/')
    if (value && !value.startsWith('../') && value !== '..') return value
  }
  return `projects/${sourceProjectId}/.loop/project.yaml`
}

export class WorkspaceRegistryStore {
  constructor(domain) {
    this.domain = domain
    this.closed = false
  }

  static async open(ctx) {
    const storage = requireHostService(ctx, 'storageDomain', 'open')
    return new WorkspaceRegistryStore(await storage.open(workspaceRegistryDomainSpec))
  }

  async saveWorkspace(workspace, projects) {
    this.assertOpen()
    const normalizedWorkspace = cloneCanonical({
      schemaVersion: 'xiaobai.workspace/v1',
      workspaceId: workspace.id,
      hostWorkspaceId: workspace.hostId,
      rootDigest: sha256Digest(workspace.path),
      title: workspace.title,
      configDigest: workspace.configDigest,
      sourceRevision: workspace.sourceRevision,
      status: workspace.status,
      updatedAt: new Date().toISOString(),
    })
    await this.domain.table('workspace_records').put(workspace.id, normalizedWorkspace)
    const projectTable = this.domain.table('project_baselines')
    const desiredKeys = new Set(projects.map((project) => `${workspace.id}:${project.baseline.projectId}`))
    for (const [key, value] of entries(projectTable)) {
      if (value.workspaceId !== workspace.id || desiredKeys.has(key)) continue
      if (typeof projectTable.delete !== 'function') {
        throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host storage table does not support stale Project cleanup', { phase: 'workspace-persistence', expected: 'project_baselines.delete' })
      }
      await projectTable.delete(key)
    }
    for (const project of projects) {
      await projectTable.put(`${workspace.id}:${project.baseline.projectId}`, cloneCanonical({
        schemaVersion: 'xiaobai.workspace/v1',
        workspaceId: workspace.id,
        projectId: project.baseline.projectId,
        sourceProjectId: project.sourceProjectId,
        baseline: project.baseline,
        configLocator: configLocator(workspace.path, project.configPath, project.sourceProjectId),
        configDigest: project.configDigest,
        pathBindingDigest: project.pathBindingDigest,
        // Local paths are machine state. Persist their digest and status, never
        // their absolute values, so recovery cannot turn storage into a path leak.
        background: persistentBackground(project.background),
        knowledgeStatus: project.knowledgeStatus,
        repositoryStatuses: project.repositoryStatuses,
        updatedAt: new Date().toISOString(),
      }))
    }
    return normalizedWorkspace
  }

  getWorkspace(workspaceId) {
    this.assertOpen()
    return this.domain.table('workspace_records').get(workspaceId)
  }

  findWorkspaceByRoot(root) {
    this.assertOpen()
    const digest = sha256Digest(root)
    return entries(this.domain.table('workspace_records')).map(([, value]) => value).find((value) => value.rootDigest === digest || value.root === root)
  }

  listProjects(workspaceId) {
    this.assertOpen()
    return entries(this.domain.table('project_baselines'))
      .map(([, value]) => value)
      .filter((value) => value.workspaceId === workspaceId)
      .sort((left, right) => left.projectId.localeCompare(right.projectId))
  }

  listWorkspaces() {
    this.assertOpen()
    return entries(this.domain.table('workspace_records'))
      .map(([, value]) => value)
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
  }

  listLoadAttempts(workspaceId) {
    this.assertOpen()
    return entries(this.domain.table('load_attempts'))
      .map(([, value]) => value)
      .filter((value) => !workspaceId || value.workspaceId === workspaceId)
      .sort((left, right) => String(left.startedAt).localeCompare(String(right.startedAt)))
  }

  listConflicts(workspaceId) {
    this.assertOpen()
    return entries(this.domain.table('config_conflicts'))
      .map(([, value]) => value)
      .filter((value) => !workspaceId || value.workspaceId === workspaceId)
      .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
  }

  async recordLoadAttempt(value) {
    this.assertOpen()
    if (!value?.loadId) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Load attempt requires loadId', { phase: 'workspace-persistence' })
    await this.domain.table('load_attempts').put(value.loadId, cloneCanonical(value))
    return value
  }

  async recordConflict(value) {
    this.assertOpen()
    if (!value?.conflictId) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Configuration conflict requires conflictId', { phase: 'workspace-persistence' })
    await this.domain.table('config_conflicts').put(value.conflictId, cloneCanonical(value))
    return value
  }

  async saveProjection(projection) {
    this.assertOpen()
    if (!projection?.projectionId) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Monitor projection requires projectionId', { phase: 'projection-persistence' })
    await this.domain.table('monitor_projections').put(projection.projectionId, cloneCanonical(projection))
    return projection
  }

  getProjection(projectionId) {
    this.assertOpen()
    return this.domain.table('monitor_projections').get(projectionId)
  }

  async close() {
    if (this.closed) return
    this.closed = true
    if (typeof this.domain?.close === 'function') await this.domain.close()
  }

  assertOpen() {
    if (this.closed) throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Workspace registry storage is closed', { phase: 'workspace-persistence' })
  }
}
