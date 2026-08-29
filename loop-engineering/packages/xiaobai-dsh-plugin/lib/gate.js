import { randomUUID } from 'node:crypto'
import { ERROR_CODES } from './constants.js'
import { sha256Digest } from './canonical.js'
import { validateContract } from './contracts.js'
import { contractError, XiaobaiError } from './errors.js'
import { getHostService, registerApprovalAnswerer } from './host.js'

export function registerGateAnswerer(ctx, policy) {
  return registerApprovalAnswerer(ctx, async (request, next) => {
    if (!policy || typeof policy.decide !== 'function') return next()
    return policy.decide(request)
  })
}

export async function requestGate({ ctx, agent, gateId = `gate_${randomUUID().replaceAll('-', '')}`, input, actor, reason, evidence = [], signal }) {
  const approval = getHostService(ctx, 'approval')
  if (!approval || typeof approval.request !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host approval.request is unavailable', { resourceId: gateId, phase: 'approval-gate' })
  if (!agent || !agent.session) throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'Human Gate requires a live Agent session', { resourceId: gateId, phase: 'approval-gate' })
  if (input === undefined) throw contractError('Human Gate input is required', { resourceId: gateId, phase: 'approval-gate' })
  if (!Array.isArray(evidence) || evidence.length === 0) throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, 'Human Gate requires evidence before asking for approval', { resourceId: gateId, phase: 'approval-gate' })
  const toolName = `xiaobai-gate/${gateId}`
  const auditStartIndex = Array.isArray(agent.session.events) ? agent.session.events.length : undefined
  let outcome
  try {
    outcome = await approval.request({ agent, toolName, reason, signal })
  } catch (error) {
    throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, `Host approval request failed before an audited decision: ${error instanceof Error ? error.message : String(error)}`, { resourceId: gateId, phase: 'approval-request', cause: error, remediation: 'Ask the Gate from a live Host Agent turn and preserve its approval audit pair.' })
  }
  const mapped = outcome === 'allowed-once' ? 'allowed' : outcome
  const audit = approvalAuditPair(agent, outcome, { startIndex: auditStartIndex, toolName })
  if (!audit.asked || !audit.decided) throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, 'Host approval returned without an approval/asked + approval/decided audit pair', { resourceId: gateId, phase: 'approval-audit', actual: audit, remediation: 'Keep the Gate inside a live Host turn with session persistence enabled.' })
  const decision = validateContract('gateDecision', { gateId, outcome: mapped, actor: actor ?? 'human-gate', reason: reason ?? 'Project delivery gate', timestamp: new Date().toISOString(), inputDigest: sha256Digest(input), evidence: [...evidence], approval: { outcome, auditRequired: true, asked: audit.asked, decided: audit.decided, requestId: audit.requestId } })
  if (typeof ctx.emit === 'function') ctx.emit('xiaobai/gate-decision', decision)
  return decision
}

function approvalAuditPair(agent, outcome, options = {}) {
  const allEvents = Array.isArray(agent?.session?.events) ? agent.session.events : []
  const events = options.startIndex === undefined ? [] : allEvents.slice(options.startIndex)
  const decidedIndex = [...events].findLastIndex((event) => event.type === 'approval/decided' && event.data?.outcome === outcome)
  const decided = decidedIndex === -1 ? undefined : events[decidedIndex]
  const asked = decided
    ? [...events.slice(0, decidedIndex)].reverse().find((event) => event.type === 'approval/asked' && event.data?.id === decided.data?.id && event.data?.toolName === options.toolName)
    : undefined
  return { asked: asked !== undefined, decided: decided !== undefined, requestId: decided?.data?.id }
}

export function assertGateSuccess(decision) {
  if (!decision || decision.outcome !== 'allowed' || !decision.approval?.auditRequired || !decision.approval?.asked || !decision.approval?.decided || !Array.isArray(decision.evidence) || decision.evidence.length === 0) throw new XiaobaiError(ERROR_CODES.GATE_EVIDENCE_MISSING, 'A stage cannot enter success without an approved, audited Gate decision', { resourceId: decision?.gateId, phase: 'success-transition', expected: 'allowed with approval audit and evidence', actual: decision, remediation: 'Complete the approval audit pair before entering success.' })
  return decision
}
