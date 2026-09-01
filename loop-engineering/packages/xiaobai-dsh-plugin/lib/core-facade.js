import { access, readFile, readdir, realpath } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import YAML from 'yaml'
import { ERROR_CODES } from './constants.js'
import { sha256Digest } from './canonical.js'
import { XiaobaiError } from './errors.js'

const CATALOG_SCHEMA_VERSION = 'xiaobai.loop-catalog/v1'
const PLAN_SCHEMA_VERSION = 'xiaobai.loop-plan/v1'

async function exists(filePath) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function sourceRef(workspaceRoot, filePath) {
  return relative(workspaceRoot, filePath).split(sep).join('/')
}

function packageBasename(value) {
  return String(value).replaceAll('\\', '/').split('/').at(-1)
}

function relativeLocator(value) {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return undefined
  if (value.startsWith('/') || value === '..' || value.startsWith('../')) return undefined
  return value.replace(/^\.\//, '')
}

function stageProjection(stage = {}) {
  return {
    id: String(stage.id ?? 'unnamed-stage'),
    kind: String(stage.kind ?? 'unspecified'),
    gate: String(stage.gate ?? 'unspecified'),
    owner: stage.agent ?? stage.evaluator ?? null,
    agent: stage.agent ?? null,
    evaluator: stage.evaluator ?? null,
    harness: stage.harness ?? null,
    dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn.map(String) : [],
    requiredChecks: Array.isArray(stage.requiredChecks) ? stage.requiredChecks.map(String) : [],
    requiredGates: Array.isArray(stage.requiredGates) ? stage.requiredGates.map(String) : [],
    requiredBefore: Array.isArray(stage.requiredBefore) ? stage.requiredBefore.map(String) : [],
    outputs: Array.isArray(stage.outputs) ? stage.outputs.map(String) : [],
  }
}

function memoryProjection(value = {}) {
  const memory = value.persistence?.memory ?? {}
  return {
    stateFile: relativeLocator(memory.stateFile),
    inboxFile: relativeLocator(memory.inboxFile),
    runLog: relativeLocator(memory.runLog),
  }
}

function evidenceLocators(value = {}) {
  const outputPaths = (Array.isArray(value.persistence?.outputs) ? value.persistence.outputs : [])
    .map((output) => relativeLocator(output?.path))
    .filter(Boolean)
  const runLog = relativeLocator(value.persistence?.memory?.runLog)
  return [...new Set([runLog, ...outputPaths].filter(Boolean))]
}

function projectLoop(value, source, sourceKind, defaultProjectId) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'Loop configuration must be an object', { phase: 'loop-catalog', actual: source })
  }
  const id = value.metadata?.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, 'Loop metadata.id is required', { phase: 'loop-catalog', actual: source })
  }
  const stages = Array.isArray(value.workflow?.stages) ? value.workflow.stages.map(stageProjection) : []
  const requiredChecks = Array.isArray(value.verification?.requiredChecks) ? value.verification.requiredChecks.map(String) : []
  const humanGates = Array.isArray(value.humanGate?.requiredBefore) ? value.humanGate.requiredBefore.map(String) : []
  const targetProjectId = value.handoff?.project ? String(value.handoff.project) : defaultProjectId
  return {
    schemaVersion: 'xiaobai.loop/v1',
    loopId: id,
    name: String(value.metadata?.name ?? id),
    owner: String(value.metadata?.owner ?? 'unassigned'),
    source,
    sourceKind,
    sourceDigest: sha256Digest(value),
    targetProjectId,
    targetResolution: {
      required: value.handoff?.targetResolution?.required === true,
      strategy: value.handoff?.strategy ? String(value.handoff.strategy) : null,
      project: targetProjectId ?? null,
    },
    orchestrator: value.orchestrator?.agent ? String(value.orchestrator.agent) : null,
    generator: value.generator?.agent ? String(value.generator.agent) : null,
    harness: value.generator?.harness ? String(value.generator.harness) : null,
    evaluator: value.verification?.evaluator ? String(value.verification.evaluator) : null,
    allowSelfReview: value.verification?.allowSelfReview === true,
    requiredChecks,
    humanGates,
    humanGateDefinitions: Array.isArray(value.humanGate?.gates)
      ? value.humanGate.gates.map((gate) => ({
        id: String(gate?.id ?? 'unnamed-gate'),
        requiredBefore: String(gate?.requiredBefore ?? 'unspecified'),
        reviewers: Array.isArray(gate?.reviewers) ? gate.reviewers.map(String) : [],
        requiredEvidenceTypes: Array.isArray(gate?.requiredEvidenceTypes) ? gate.requiredEvidenceTypes.map(String) : [],
      }))
      : [],
    schedule: {
      type: String(value.schedule?.type ?? 'manual'),
      expression: String(value.schedule?.expression ?? 'on-demand'),
      timezone: value.schedule?.timezone ? String(value.schedule.timezone) : null,
    },
    budget: {
      maxTokensPerRun: value.budget?.maxTokensPerRun ?? null,
      maxRunsPerDay: value.budget?.maxRunsPerDay ?? null,
      maxRetriesPerTask: value.budget?.maxRetriesPerTask ?? null,
      maxParallelTasks: value.budget?.maxParallelTasks ?? null,
    },
    contextSources: {
      discoverySkill: value.discovery?.skill ? String(value.discovery.skill) : null,
      discoverySources: Array.isArray(value.discovery?.sources)
        ? value.discovery.sources.map((item) => ({ type: String(item?.type ?? 'unknown'), connector: item?.connector ? String(item.connector) : null, path: relativeLocator(item?.path) }))
        : [],
      orchestrator: value.orchestrator?.agent ? String(value.orchestrator.agent) : null,
      generator: value.generator?.agent ? String(value.generator.agent) : null,
      evaluator: value.verification?.evaluator ? String(value.verification.evaluator) : null,
      harness: value.generator?.harness ? String(value.generator.harness) : null,
    },
    memory: memoryProjection(value),
    memoryWrites: Object.values(memoryProjection(value)).filter(Boolean),
    evidenceLocators: evidenceLocators(value),
    stages,
    stageCount: stages.length,
    executionStatus: 'plan-only',
  }
}

async function packageEntries(workspaceRoot) {
  const projectsRoot = resolve(workspaceRoot, 'projects')
  if (!(await exists(projectsRoot))) return []
  const directories = (await readdir(projectsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
  const records = []
  for (const directory of directories) {
    const projectRoot = resolve(projectsRoot, directory)
    const configPath = resolve(projectRoot, '.loop/project.yaml')
    if (!(await exists(configPath))) continue
    try {
      records.push({ projectId: directory, projectRoot, config: YAML.parse(await readFile(configPath, 'utf8')) })
    } catch (error) {
      records.push({ projectId: directory, projectRoot, configError: error })
    }
  }
  const catalogs = new Map(records
    .filter((entry) => entry.config?.role === 'catalog')
    .map((entry) => [entry.config.id ?? entry.projectId, entry]))
  const entries = []
  for (const record of records) {
    if (record.configError) {
      entries.push(record)
      continue
    }
    let config = record.config
    if (config?.kind === 'Project' && config?.role === 'standalone' && config.catalogId) {
      const catalog = catalogs.get(config.catalogId)
      if (!catalog) {
        entries.push({ ...record, configError: new Error(`Standalone Project '${config.id}' references a missing catalog '${config.catalogId}'`) })
        continue
      }
      config = materializeStandaloneProject(config, catalog.config, catalog.projectRoot, record.projectRoot)
    }
    if (config?.role === 'catalog' && records.some((candidate) => candidate.config?.role === 'standalone' && catalogReference(candidate.config) === config.id)) continue
    entries.push({ ...record, config })
  }
  return entries
}

function catalogReference(project) {
  return project?.catalogId ?? project?.parentGroup
}

function materializeStandaloneProject(project, catalog, catalogRoot, projectRoot) {
  const background = catalog?.background
    ? { ...catalog.background, mount: rebasePath(catalogRoot, projectRoot, catalog.background.mount), integration: catalog.background.integration }
    : undefined
  const discoverySkills = catalog?.discoverySkills
    ? Object.fromEntries(Object.entries(catalog.discoverySkills).map(([id, value]) => [id, rebasePath(catalogRoot, projectRoot, value)]))
    : undefined
  const skill = catalog?.skill ? rebasePath(catalogRoot, projectRoot, catalog.skill) : undefined
  return {
    ...catalog,
    ...project,
    kind: 'Project',
    role: 'standalone',
    parentGroup: project.parentGroup ?? catalog?.id,
    skill: project.skill ?? skill ?? 'SKILL.md',
    ...(project.background ? {} : background ? { background } : {}),
    ...(project.discoverySkills ? {} : discoverySkills ? { discoverySkills } : {}),
    ...(project.sharedContext ? {} : catalog?.sharedContext ? { sharedContext: catalog.sharedContext } : {}),
  }
}

function rebasePath(fromRoot, toRoot, relativePath) {
  return relative(toRoot, resolve(fromRoot, relativePath)) || '.'
}

async function packageLoopFiles(workspaceRoot) {
  const declared = new Map()
  const diagnostics = []
  for (const entry of await packageEntries(workspaceRoot)) {
    if (entry.configError) {
      diagnostics.push({ code: ERROR_CODES.CONFIG_INVALID, severity: 'error', source: `projects/${entry.projectId}/.loop/project.yaml`, message: entry.configError.message })
      continue
    }
    const assets = entry.config?.background?.integration?.assets?.loops ?? {}
    if (!entry.config?.background?.mount || Object.keys(assets).length === 0) continue
    let packageRoot
    const mount = resolve(entry.projectRoot, entry.config.background.mount)
    if (!(await exists(mount))) {
      for (const loopId of Object.keys(assets)) {
        diagnostics.push({ code: 'XIAOBAI_SKILL_PACKAGE_UNAVAILABLE', severity: 'warning', source: `skill-package:${entry.projectId}`, message: `Skill package mount is unavailable for declared loop '${loopId}'.` })
      }
      continue
    }
    try {
      packageRoot = await realpath(mount)
    } catch (error) {
      diagnostics.push({ code: ERROR_CODES.PATH_ESCAPE, severity: 'error', source: `skill-package:${entry.projectId}`, message: error.message })
      continue
    }
    for (const [loopId, relativePath] of Object.entries(assets)) {
      const filePath = resolve(packageRoot, relativePath)
      const lexical = relative(packageRoot, filePath)
      if (lexical === '..' || lexical.startsWith(`..${sep}`) || lexical.startsWith('/')) {
        diagnostics.push({ code: ERROR_CODES.PATH_ESCAPE, severity: 'error', source: `skill-package:${entry.projectId}/${relativePath}`, message: 'Declared Skill Package Loop escapes its mount root.' })
        continue
      }
      if (!(await exists(filePath))) {
        diagnostics.push({ code: ERROR_CODES.CONFIG_INVALID, severity: 'error', source: `skill-package:${entry.projectId}/${relativePath}`, message: `Declared Skill Package Loop '${loopId}' is missing.` })
        continue
      }
      try {
        const canonical = await realpath(filePath)
        const canonicalRelative = relative(packageRoot, canonical)
        if (canonicalRelative === '..' || canonicalRelative.startsWith(`..${sep}`) || canonicalRelative.startsWith('/')) throw new Error('Declared Skill Package Loop escapes its mount root.')
        const existing = declared.get(loopId)
        if (existing) {
          if (existing.filePath === canonical) continue
          throw new Error(`Skill Package Loop '${loopId}' is declared by multiple Projects.`)
        }
        declared.set(loopId, { filePath: canonical, source: `skill-package:${entry.projectId}/${String(relativePath).replaceAll('\\', '/')}`, projectId: entry.config.id ?? entry.projectId })
      } catch (error) {
        diagnostics.push({ code: error.code ?? ERROR_CODES.CONFIG_INVALID, severity: 'error', source: `skill-package:${entry.projectId}/${relativePath}`, message: error.message })
      }
    }
  }
  return { declared, diagnostics }
}

async function discoverLoopFiles(workspaceRoot) {
  let root
  try {
    root = await realpath(resolve(workspaceRoot))
  } catch (error) {
    throw new XiaobaiError(ERROR_CODES.PATH_ESCAPE, `Workspace root '${workspaceRoot}' cannot be resolved`, { phase: 'loop-catalog', actual: workspaceRoot, cause: error })
  }
  const diagnostics = []
  const workspaceLoopRoot = resolve(root, 'loops')
  const workspaceFiles = (await exists(workspaceLoopRoot)
    ? await readdir(workspaceLoopRoot, { withFileTypes: true })
    : [])
    .filter((entry) => entry.isFile() && entry.name.endsWith('.loop.yaml'))
    .map((entry) => ({ filePath: resolve(workspaceLoopRoot, entry.name), source: sourceRef(root, resolve(workspaceLoopRoot, entry.name)), sourceKind: 'workspace', projectId: undefined }))
  const packageFiles = await packageLoopFiles(root)
  diagnostics.push(...packageFiles.diagnostics)
  const packageIds = new Set(packageFiles.declared.keys())
  const files = workspaceFiles.filter(({ filePath }) => !packageIds.has(filePath.split('/').at(-1).replace(/\.loop\.yaml$/, '')))
  for (const item of packageFiles.declared.values()) files.push({ ...item, sourceKind: 'skill-package' })
  return { root, files: files.sort((left, right) => left.source.localeCompare(right.source)), diagnostics }
}

export async function loadCoreLoopCatalog(workspaceRoot) {
  const discovered = await discoverLoopFiles(workspaceRoot)
  const loops = []
  const diagnostics = [...discovered.diagnostics]
  const ids = new Set()
  for (const item of discovered.files) {
    try {
      const value = YAML.parse(await readFile(item.filePath, 'utf8'))
      const loop = projectLoop(value, item.source, item.sourceKind, item.projectId)
      if (ids.has(loop.loopId)) throw new XiaobaiError(ERROR_CODES.CONFIG_INVALID, `Duplicate Loop id '${loop.loopId}' in catalog`, { phase: 'loop-catalog', resourceId: loop.loopId })
      ids.add(loop.loopId)
      loops.push(loop)
    } catch (error) {
      diagnostics.push({ code: error.code ?? ERROR_CODES.CONFIG_INVALID, severity: 'error', source: item.source, message: error.message })
    }
  }
  const catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    loops: loops.sort((left, right) => left.loopId.localeCompare(right.loopId)),
    diagnostics,
    status: diagnostics.some((diagnostic) => diagnostic.severity === 'error') ? 'invalid' : diagnostics.length > 0 ? 'attention' : 'loaded',
  }
  // Keep the canonical root available to service code without serializing a
  // machine path into command, projection, or CLI output.
  Object.defineProperty(catalog, 'workspaceRoot', { value: discovered.root, enumerable: false })
  return catalog
}

export async function listCoreLoopSpecs(workspaceRoot) {
  const discovered = await discoverLoopFiles(workspaceRoot)
  return discovered.files.map((item) => item.filePath).sort()
}

export async function findCoreLoopSpec(workspaceRoot, loopId) {
  const discovered = await discoverLoopFiles(workspaceRoot)
  const requested = typeof loopId === 'string' && loopId.length > 0 ? packageBasename(loopId).replace(/\.loop\.yaml$/, '') : undefined
  const matches = discovered.files.filter((item) => packageBasename(item.filePath).replace(/\.loop\.yaml$/, '') === requested)
  if (matches.length === 0) throw new Error(`Loop spec not found: ${loopId ?? 'none'}`)
  if (matches.length > 1) throw new Error(`Loop spec is ambiguous: ${loopId}. Candidates: ${matches.map((item) => item.source).join(', ')}`)
  return matches[0].filePath
}

export function assessCoreLoop(loop) {
  const missing = []
  if (!loop.targetProjectId) missing.push('handoff.project')
  if (loop.targetResolution?.required !== true) missing.push('handoff.targetResolution.required')
  if (loop.stageCount === 0) missing.push('workflow.stages')
  if (!loop.evaluator) missing.push('verification.evaluator')
  if (loop.allowSelfReview) missing.push('verification.allowSelfReview=false')
  return { loopId: loop.loopId, valid: missing.length === 0, missing, executionStatus: loop.executionStatus, sourceDigest: loop.sourceDigest }
}

export function planCoreLoop(loop, input = {}) {
  const assessment = assessCoreLoop(loop)
  const projectId = input.projectId ?? input.targetProject ?? loop.targetProjectId ?? null
  return {
    schemaVersion: PLAN_SCHEMA_VERSION,
    planId: `plan_${sha256Digest({ loopId: loop.loopId, sourceDigest: loop.sourceDigest, projectId }).slice(7, 19)}`,
    loopId: loop.loopId,
    projectId,
    status: assessment.valid ? 'plan-only' : 'blocked',
    executionStatus: 'plan-only',
    blockers: assessment.valid ? ['execution-bridge-unavailable'] : assessment.missing,
    targetResolution: {
      required: loop.targetResolution?.required === true,
      requested: {
        projectId: input.projectId ?? null,
        targetProject: input.targetProject ?? null,
        targetRepository: input.targetRepository ?? null,
        targetCwd: input.targetCwd ?? null,
        targetRemote: input.targetRemote ?? null,
      },
      resolvedProjectId: projectId,
      strategy: loop.targetResolution?.strategy,
    },
    contextSources: loop.contextSources,
    stages: loop.stages,
    budget: loop.budget,
    requiredChecks: loop.requiredChecks,
    humanGates: loop.humanGates,
    humanGateDefinitions: loop.humanGateDefinitions,
    memory: loop.memory,
    memoryWrites: loop.memoryWrites,
    evidenceLocators: loop.evidenceLocators,
    source: loop.source,
    sourceDigest: loop.sourceDigest,
  }
}

export function redactCoreText(value) {
  return String(value ?? '')
    .replaceAll(/https?:\/\/[^\s)]+/gi, '[redacted-url]')
    .replaceAll(/(^|[\s'"(])\/(?!\/)[^\s'"),]*/g, '$1[redacted-path]')
}

export const CORE_FACADE_SCHEMA_VERSION = 'xiaobai.core/v1'
