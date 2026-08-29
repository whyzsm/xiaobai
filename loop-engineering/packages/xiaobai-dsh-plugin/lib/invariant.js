import { ERROR_CODES } from './constants.js'

const PACKAGE_NAME = '@xiaobai/dsh-plugin'

export const inject = ['invariants']

export function assertProjectIsolation(ownerProjectId, value) {
  if (value?.projectId !== ownerProjectId) throw new Error(`${ERROR_CODES.CAPABILITY_DENIED}: resource project '${value?.projectId}' differs from scope '${ownerProjectId}'`)
  return true
}

export function assertRunEvidence(value) {
  if (!value?.lock || !value?.policyDigest || !value?.memoryNamespaceId) throw new Error(`${ERROR_CODES.CONTRACT_INVALID}: run evidence lacks lock, policy digest, or Memory namespace`)
  return true
}

export function assertGateAudit(value) {
  if (!value?.approval?.asked || !value?.approval?.decided) throw new Error(`${ERROR_CODES.GATE_EVIDENCE_MISSING}: Gate decision lacks the approval audit pair`)
  return true
}

function install(ctx, fail) {
  ctx.on('domain/changed', (change) => {
    if (change.domain !== 'xiaobai_memory' || change.table !== 'records' || change.operation !== 'put') return
    const expectedKey = `${change.value?.projectId}:`
    if (typeof change.key !== 'string' || !change.key.startsWith(expectedKey)) fail(`Memory record key '${change.key}' does not match project '${change.value?.projectId}'`)
  })
  ctx.on('xiaobai/gate-decision', (decision) => {
    try { assertGateAudit(decision) } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  })
  ctx.on('xiaobai/stage-success', (evidence) => {
    try { assertRunEvidence(evidence) } catch (error) { fail(error instanceof Error ? error.message : String(error)) }
  })
}

export function apply(ctx) {
  return ctx.invariants.register(PACKAGE_NAME, install)
}
