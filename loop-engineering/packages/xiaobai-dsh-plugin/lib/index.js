import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { createScope } from '@deepseek-ai/dsh-scope'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { ERROR_CODES, PACKAGE_NAME } from './constants.js'
import { XiaobaiError } from './errors.js'
import { probeHostCapabilities, getHostService, registerApprovalAnswerer } from './host.js'
import { registerSkillProvider } from './skill.js'
import { registerTypedContracts } from './typed.js'
import { apply as applyInvariant } from './invariant.js'
import { runMinimumVerticalPath } from './vertical-path.js'
import { ProjectRegistry } from './project.js'
import { registerProjectCommands } from './commands.js'
import { registerPolicyService } from './policy.js'

const REPORT_ENV = 'XIAOBAI_DSH_M0_REPORT'

function errorText(error) {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}

function createReport() {
  return { package: PACKAGE_NAME, packageVersion: '0.1.0', loaded: true, observedAt: new Date().toISOString(), versions: {}, capabilities: {}, registrations: {}, operations: [] }
}

function flushReport(report) {
  const target = process.env[REPORT_ENV]
  if (!target) return
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
}

function recordOperation(report, name, status, details = {}) {
  report.operations.push({ name, status, ...details })
  flushReport(report)
}

async function probeWorkflow(ctx, report) {
  const workflowEngine = getHostService(ctx, 'workflowEngine')
  report.capabilities.workflowEngine = { available: workflowEngine !== undefined, method: 'start', callable: typeof workflowEngine?.start === 'function' }
  if (typeof workflowEngine?.start !== 'function') return
  let run
  try {
    run = workflowEngine.start({ script: 'return { probe: "passed" }', meta: { name: 'xiaobai-m0-probe', description: 'M0 workflow seam probe' }, parent: {} })
    const result = await run.result
    report.registrations.workflow = { started: true, result: result.stopReason, value: result.value }
    recordOperation(report, 'workflowEngine.start', result.stopReason === 'completed' ? 'passed' : 'failed', { stopReason: result.stopReason })
  } catch (error) {
    report.registrations.workflow = { started: false, error: errorText(error) }
    recordOperation(report, 'workflowEngine.start', 'failed', { error: errorText(error) })
  } finally {
    if (run) {
      try {
        if (typeof run.dispose !== 'function') throw new Error('Host WorkflowRun.dispose is unavailable')
        await run.dispose()
        recordOperation(report, 'workflowRun.dispose', 'passed')
      } catch (error) {
        recordOperation(report, 'workflowRun.dispose', 'failed', { error: errorText(error) })
      }
    }
  }
}

async function probeWebServices(ctx, report) {
  const workspaceRegistry = getHostService(ctx, 'workspaceRegistry')
  report.capabilities.workspaceRegistry = {
    available: workspaceRegistry !== undefined,
    methods: {
      create: typeof workspaceRegistry?.create === 'function',
      delete: typeof workspaceRegistry?.delete === 'function',
    },
  }
  let workspace
  let temporaryPath
  if (typeof workspaceRegistry?.create === 'function') {
    try {
      temporaryPath = await mkdtemp(join(tmpdir(), 'xiaobai-m0-'))
      workspace = await workspaceRegistry.create(temporaryPath, 'xiaobai-m0')
      report.registrations.workspace = { created: true, id: workspace.id, path: workspace.path }
      recordOperation(report, 'workspaceRegistry.create', 'passed', { id: workspace.id })
    } catch (error) {
      recordOperation(report, 'workspaceRegistry.create', 'failed', { error: errorText(error) })
    }
  } else {
    recordOperation(report, 'workspaceRegistry.create', 'failed', { error: 'Host workspaceRegistry.create is unavailable' })
  }
  const storageDomain = getHostService(ctx, 'storageDomain')
  report.capabilities.storageDomain = { available: storageDomain !== undefined, method: 'open', callable: typeof storageDomain?.open === 'function' }
  let domain
  if (typeof storageDomain?.open === 'function') {
    try {
      domain = await storageDomain.open(defineDomain({ name: 'xiaobai_m0', version: 1, tables: { probes: { valueSchema: { parse(value) { if (value === null || typeof value !== 'object') throw new Error('record must be an object'); return value } } } } }))
      await domain.table('probes').put('external-plugin', { passed: true })
      const value = domain.table('probes').get('external-plugin')
      report.registrations.storageDomain = { opened: true, wrote: value?.passed === true }
      recordOperation(report, 'storageDomain.open/table.put', value?.passed === true ? 'passed' : 'failed')
    } catch (error) {
      recordOperation(report, 'storageDomain.open/table.put', 'failed', { error: errorText(error) })
    } finally {
      if (domain) {
        try { await domain.close(); recordOperation(report, 'storageDomain.close', 'passed') } catch (error) { recordOperation(report, 'storageDomain.close', 'failed', { error: errorText(error) }) }
      }
    }
  } else {
    recordOperation(report, 'storageDomain.open/table.put', 'failed', { error: 'Host storageDomain.open is unavailable' })
  }
  if (workspace) {
    try {
      if (typeof workspaceRegistry?.delete !== 'function') throw new Error('Host workspaceRegistry.delete is unavailable')
      await workspaceRegistry.delete(workspace.id)
      recordOperation(report, 'workspaceRegistry.delete', 'passed', { id: workspace.id })
    } catch (error) {
      recordOperation(report, 'workspaceRegistry.delete', 'failed', { id: workspace.id, error: errorText(error) })
    }
  }
  if (temporaryPath) {
    try { await rm(temporaryPath, { recursive: true, force: true }) } catch (error) { recordOperation(report, 'm0-temp-directory.remove', 'failed', { error: errorText(error) }) }
  }
}

async function runM0Probe(ctx, config = {}) {
  const report = createReport()
  flushReport(report)
  let skillDisposer
  let approvalDisposer
  let invariantDisposer
  let typertDisposer
  let probeScope
  let primaryFailure
  const cleanupErrors = []
  try {
    const capability = probeHostCapabilities(ctx, [
      { key: 'skills', method: 'registerProvider', required: true },
      { key: 'approval', method: 'request', required: true },
      { key: 'invariants', method: 'register', required: true },
      { key: 'typert', method: 'register', required: true },
    ])
    report.capabilities = { ...report.capabilities, ...capability.capabilities }
    report.versions = capability.versions
    skillDisposer = registerSkillProvider(ctx, {
      skillId: 'skill_m0_probe', name: 'm0-probe', version: '1.0.0', purpose: 'Verify the external dsh Skill seam', owner: PACKAGE_NAME,
      invocation: { modelInvocable: false, userInvocable: true }, requiredContext: [], capabilities: [], sideEffects: [], evidenceRequirements: [], trust: 'bundled',
    }, { content: 'M0 host seam probe skill.' })
    report.registrations.skills = { registered: true, disposer: typeof skillDisposer === 'function' }
    recordOperation(report, 'skills.registerProvider', typeof skillDisposer === 'function' ? 'passed' : 'failed')
    if (typeof skillDisposer !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host skills.registerProvider did not return a disposer', { phase: 'm0-probe' })
    approvalDisposer = registerApprovalAnswerer(ctx, async (_request, next) => next())
    report.registrations.approval = { registered: true, disposer: typeof approvalDisposer === 'function' }
    recordOperation(report, 'approval/request listener', typeof approvalDisposer === 'function' ? 'passed' : 'failed')
    if (typeof approvalDisposer !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host approval/request registration did not return a disposer', { phase: 'm0-probe' })
    invariantDisposer = await applyInvariant(ctx)
    report.registrations.invariants = { registered: true, disposer: typeof invariantDisposer === 'function' }
    recordOperation(report, 'invariants.register', typeof invariantDisposer === 'function' ? 'passed' : 'failed')
    if (typeof invariantDisposer !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host invariants.register did not return a disposer', { phase: 'm0-probe' })
    typertDisposer = registerTypedContracts(ctx)
    report.registrations.typert = { registered: true, disposer: typeof typertDisposer === 'function' }
    recordOperation(report, 'typert.register', typeof typertDisposer === 'function' ? 'passed' : 'failed')
    if (typeof typertDisposer !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host typert.register did not return a disposer', { phase: 'm0-probe' })
    const typert = getHostService(ctx, 'typert')
    const projection = typeof typert?.toJSONSchema === 'function' ? typert.toJSONSchema(`${PACKAGE_NAME}#ProjectBaseline`) : undefined
    report.registrations.typert.jsonSchemaProjection = { available: projection !== undefined, type: projection?.type, required: projection?.required }
    recordOperation(report, 'typert.toJSONSchema', projection !== undefined ? 'passed' : 'failed')
    probeScope = createScope(ctx, {})
    report.registrations.scope = { created: true, contextCreated: probeScope.ctx !== undefined, disposerCreated: typeof probeScope.dispose === 'function' }
    if (probeScope.ctx === undefined || typeof probeScope.dispose !== 'function') {
      recordOperation(report, 'createScope/dispose', 'failed')
      throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host scope did not return a disposer', { phase: 'm0-probe' })
    }
    await probeScope.dispose()
    probeScope = undefined
    recordOperation(report, 'createScope/dispose', 'passed')
    if (config.probeWorkflowRoot === true) await ctx.inject(['workflowEngine'], (scopeCtx) => probeWorkflow(scopeCtx, report))
    else await probeWorkflow(ctx, report)
    if (config.probeWebServices === true) await ctx.inject(['workspaceRegistry', 'storageDomain'], (scopeCtx) => probeWebServices(scopeCtx, report))
    else await probeWebServices(ctx, report)
    const failedOperation = report.operations.find((operation) => operation.status === 'failed')
    if (failedOperation) throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, `M0 probe failed at '${failedOperation.name}'`, { phase: 'm0-probe', actual: failedOperation, remediation: 'Use the verified dsh rc.6 profile and rerun the capability probe.' })
    report.completed = true
  } catch (error) {
    primaryFailure = error
    report.completed = false
    report.error = errorText(error)
    throw error
  } finally {
    if (probeScope) try { await probeScope.dispose() } catch (error) { cleanupErrors.push(error) }
    for (const [name, disposer] of [['typert', typertDisposer], ['invariants', invariantDisposer], ['approval', approvalDisposer], ['skills', skillDisposer]]) {
      if (!disposer) continue
      try { await disposer() } catch (error) { cleanupErrors.push(new Error(`${name} disposer failed`, { cause: error })) }
    }
    if (cleanupErrors.length > 0 && primaryFailure) primaryFailure.cleanupErrors = cleanupErrors
    if (cleanupErrors.length > 0 && !primaryFailure) {
      report.completed = false
      report.error = `M0 probe cleanup failed: ${cleanupErrors.map(errorText).join('; ')}`
    }
    flushReport(report)
    if (cleanupErrors.length > 0 && !primaryFailure) throw new AggregateError(cleanupErrors, 'M0 probe cleanup failed')
  }
  return report
}

export const name = PACKAGE_NAME
export const inject = ['skills', 'invariants', 'typert', 'approval']

export function apply(ctx, config = {}) {
  if (config.m0Probe === true) return runM0Probe(ctx, config)
  probeHostCapabilities(ctx, [
    { key: 'skills', method: 'registerProvider', required: true },
    { key: 'approval', method: 'request', required: true },
    { key: 'invariants', method: 'register', required: true },
    { key: 'typert', method: 'register', required: true },
  ])
  registerSkillProvider(ctx, {
    skillId: 'skill_xiaobai_context', name: 'project-context', version: '1.0.0', purpose: 'Resolve an explicit Project scope and its locked context', owner: PACKAGE_NAME,
    invocation: { modelInvocable: true, userInvocable: true }, requiredContext: ['project-scope', 'knowledge-lock'], capabilities: [], sideEffects: [], evidenceRequirements: ['context-digest'], trust: 'bundled',
  }, { content: '# project-context\n\nResolve only the current Project scope and its locked Knowledge context.' })
  registerTypedContracts(ctx)
  applyInvariant(ctx)
  registerApprovalAnswerer(ctx, async (_request, next) => next())
  registerPolicyService(ctx)
  const projectService = new ProjectRegistry(ctx, { runPath: runMinimumVerticalPath })
  ctx.provide('xiaobaiProject', projectService)
  ctx.inject(['commands'], (commandCtx) => registerProjectCommands(commandCtx, projectService))
}

export { runM0Probe, runMinimumVerticalPath }
export * from './constants.js'
export * from './errors.js'
export * from './canonical.js'
export * from './contracts.js'
export * from './host.js'
export * from './host-harness.js'
export * from './project.js'
export * from './commands.js'
export * from './path-binding.js'
export * from './knowledge.js'
export * from './lock.js'
export * from './memory.js'
export * from './skill.js'
export * from './typed.js'
export * from './workflow.js'
export * from './evaluator.js'
export * from './gate.js'
export * from './timing.js'
export * from './policy.js'
