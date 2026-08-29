import { ERROR_CODES } from './constants.js'
import { XiaobaiError } from './errors.js'
import { getHostService } from './host.js'

function sessionEvents(agent) {
  return Array.isArray(agent?.session?.events) ? agent.session.events : []
}

export function hostAgentEvidence(agent, agentContext) {
  const events = sessionEvents(agent)
  const sequences = events.map((event) => event?.seq).filter(Number.isSafeInteger)
  return {
    agentId: typeof agent?.id === 'string' ? agent.id : undefined,
    status: agent?.status,
    agentContextPresent: agentContext !== undefined,
    agentOwnedContextPresent: agent?.ctx !== undefined,
    agentContextIsAgentOwned: agent?.ctx !== undefined && agentContext !== undefined ? agent.ctx === agentContext : undefined,
    sessionEventCount: events.length,
    firstSessionSeq: sequences.length > 0 ? Math.min(...sequences) : undefined,
    lastSessionSeq: sequences.length > 0 ? Math.max(...sequences) : undefined,
    timedSessionEventCount: events.filter((event) => Number.isSafeInteger(event?.time)).length,
  }
}

/**
 * Execute a domain callback inside one real Host Agent turn.
 * The harness supplies the turn boundary; it never creates an Agent loop.
 */
export async function runHostAgentTurn({ ctx, sessionId, userMessage, createUserMessage, agentOptions, setup, run, captureEvidence = false }) {
  const agents = getHostService(ctx, 'agents')
  if (!agents || typeof agents.create !== 'function') throw new XiaobaiError(ERROR_CODES.HOST_UNSUPPORTED, 'Host agents.create is unavailable', { phase: 'agent-harness' })
  if (!sessionId || typeof sessionId !== 'string') throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Host Agent harness requires an explicit sessionId', { phase: 'agent-harness' })
  if (typeof createUserMessage !== 'function') throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Host Agent harness requires the Host user-message factory', { phase: 'agent-harness' })
  if (typeof run !== 'function') throw new XiaobaiError(ERROR_CODES.CONTRACT_INVALID, 'Host Agent harness requires a domain callback', { phase: 'agent-harness' })

  let turnResult
  let turnStarted = false
  let agentContext
  const handle = await agents.create({
    sessionId,
    agentOptions,
    setup: async (agentCtx) => {
      agentContext = agentCtx
      const setupCommit = await setup?.(agentCtx)
      agentCtx.on('agent/pre-step', async (payload) => {
        if (turnStarted) return { kind: 'reject' }
        turnStarted = true
        turnResult = Promise.resolve(run({ ctx: agentCtx, agent: payload.agent, signal: payload.signal, turn: payload.turn, step: payload.step }))
        await turnResult
        return { kind: 'enter', messages: [] }
      })
      return setupCommit
    },
  })

  let primaryFailure
  try {
    handle.agent.followup(createUserMessage(userMessage))
    await handle.agent.whenIdle()
    if (!turnResult) throw new XiaobaiError(ERROR_CODES.SCOPE_REQUIRED, 'Host Agent turn did not open for the harness request', { phase: 'agent-harness' })
    const result = await turnResult
    return captureEvidence
      ? {
          result,
          agentEvidence: hostAgentEvidence(handle.agent, agentContext),
          sessionEvents: sessionEvents(handle.agent).map((event) => ({ ...event })),
        }
      : result
  } catch (error) {
    primaryFailure = error
    throw error
  } finally {
    try {
      await handle.dispose()
    } catch (error) {
      if (primaryFailure && typeof primaryFailure === 'object') {
        primaryFailure.cleanupErrors = [...(primaryFailure.cleanupErrors ?? []), error]
      } else {
        throw new AggregateError([error], 'Host Agent harness cleanup failed')
      }
    }
  }
}
