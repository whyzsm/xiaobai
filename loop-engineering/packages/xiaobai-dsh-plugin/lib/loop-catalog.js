import { ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'
import {
  assessCoreLoop,
  loadCoreLoopCatalog,
  planCoreLoop,
} from './core-facade.js'
import { canonicalLoopForProject, loopTargetsProject, resolveWorkspaceProject } from './project-target.js'

export { loadCoreLoopCatalog as loadLoopCatalog }

export class LoopCatalogService {
  constructor(options = {}) {
    this.loader = options.loader ?? loadCoreLoopCatalog
    this.executionFacade = options.executionFacade
    this.current = undefined
    this.workspace = undefined
  }

  async load(workspaceRoot, workspace) {
    this.current = await this.loader(workspaceRoot)
    this.workspace = workspace
    return this.current
  }

  requireCatalog() {
    if (!this.current) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Load a Workspace before resolving its Loop catalog', { phase: 'loop-catalog' })
    return this.current
  }

  list(input = {}) {
    const catalog = this.requireCatalog()
    if (!input.projectId && !input.targetProject) return { ...catalog, loops: catalog.loops }
    const resolved = this.workspace
      ? resolveWorkspaceProject(this.workspace, input.projectId ?? input.targetProject, { phase: 'loop-list' })
      : { projectId: input.projectId ?? input.targetProject, entry: undefined }
    const loops = catalog.loops
      .filter((loop) => !this.workspace || loopTargetsProject(this.workspace, loop, resolved.entry))
      .map((loop) => this.workspace
        ? canonicalLoopForProject(this.workspace, loop, { projectId: resolved.projectId }, 'loop-list')
        : loop)
    return { ...catalog, loops }
  }

  requireLoop(loopId, phase) {
    const loop = this.requireCatalog().loops.find((candidate) => candidate.loopId === loopId)
    if (!loop) throw new XiaobaiError(ERROR_CODES.LOOP_NOT_FOUND, `Loop '${loopId ?? 'unknown'}' is not registered`, { resourceId: loopId, phase })
    return loop
  }

  assess(input = {}) {
    const loop = this.requireLoop(input.loopId, 'loop-assessment')
    const resolved = this.workspace ? canonicalLoopForProject(this.workspace, loop, input, 'loop-assessment') : loop
    return { ...assessCoreLoop(resolved), projectId: resolved.targetProjectId, targetProjectId: resolved.targetProjectId }
  }

  plan(input = {}) {
    const loop = this.requireLoop(input.loopId, 'loop-planning')
    const resolved = this.workspace ? canonicalLoopForProject(this.workspace, loop, input, 'loop-planning') : loop
    return planCoreLoop(resolved, { ...input, projectId: resolved.targetProjectId })
  }

  async run(input = {}) {
    if (typeof this.executionFacade !== 'function') {
      throw new XiaobaiError(ERROR_CODES.EXECUTION_UNSUPPORTED, 'This plugin exposes Loop catalog and plan only; the Host execution bridge is unavailable', { resourceId: input.loopId, phase: 'loop-run', remediation: 'Provide a verified Host Agent execution bridge before invoking loop-run.' })
    }
    const loop = this.requireLoop(input.loopId, 'loop-run')
    const resolved = this.workspace ? canonicalLoopForProject(this.workspace, loop, input, 'loop-run') : loop
    return this.executionFacade({ ...input, projectId: resolved.targetProjectId, loop: resolved })
  }
}
