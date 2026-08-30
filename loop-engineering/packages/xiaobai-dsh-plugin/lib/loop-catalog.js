import { ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'
import {
  assessCoreLoop,
  loadCoreLoopCatalog,
  planCoreLoop,
} from './core-facade.js'

export { loadCoreLoopCatalog as loadLoopCatalog }

export class LoopCatalogService {
  constructor(options = {}) {
    this.loader = options.loader ?? loadCoreLoopCatalog
    this.executionFacade = options.executionFacade
    this.current = undefined
  }

  async load(workspaceRoot) {
    this.current = await this.loader(workspaceRoot)
    return this.current
  }

  requireCatalog() {
    if (!this.current) throw new XiaobaiError(ERROR_CODES.WORKSPACE_REQUIRED, 'Load a Workspace before resolving its Loop catalog', { phase: 'loop-catalog' })
    return this.current
  }

  list(input = {}) {
    const catalog = this.requireCatalog()
    const loops = input.projectId ? catalog.loops.filter((loop) => loop.targetProjectId === input.projectId) : catalog.loops
    return { ...catalog, loops }
  }

  requireLoop(loopId, phase) {
    const loop = this.requireCatalog().loops.find((candidate) => candidate.loopId === loopId)
    if (!loop) throw new XiaobaiError(ERROR_CODES.LOOP_NOT_FOUND, `Loop '${loopId ?? 'unknown'}' is not registered`, { resourceId: loopId, phase })
    return loop
  }

  assess(input = {}) {
    return assessCoreLoop(this.requireLoop(input.loopId, 'loop-assessment'))
  }

  plan(input = {}) {
    return planCoreLoop(this.requireLoop(input.loopId, 'loop-planning'), input)
  }

  async run(input = {}) {
    if (typeof this.executionFacade !== 'function') {
      throw new XiaobaiError(ERROR_CODES.EXECUTION_UNSUPPORTED, 'This plugin exposes Loop catalog and plan only; the Host execution bridge is unavailable', { resourceId: input.loopId, phase: 'loop-run', remediation: 'Provide a verified Host Agent execution bridge before invoking loop-run.' })
    }
    return this.executionFacade({ ...input, loop: this.requireLoop(input.loopId, 'loop-run') })
  }
}
