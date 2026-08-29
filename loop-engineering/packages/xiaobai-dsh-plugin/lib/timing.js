import { validateContract } from './contracts.js'

const WAITING_PAIR_TYPES = Object.freeze({
  'tool-execution': { start: new Set(['tool/call', 'tool/execution-start']), end: new Set(['tool/result', 'tool/execution-end']) },
  'external-api': { start: new Set(['model/requested', 'llm/requested', 'external-api/requested']), end: new Set(['model/completed', 'model/failed', 'llm/completed', 'external-api/completed']) },
  'permission-wait': { start: new Set(['approval/asked', 'permission/waiting-start']), end: new Set(['approval/decided', 'permission/waiting-end']) },
  'error-blocking': { start: new Set(['error/blocked', 'error/waiting-start']), end: new Set(['error/resolved', 'error/waiting-end']) },
})

function eventTime(event) {
  return Number.isSafeInteger(event?.time) ? event.time : undefined
}

function iso(time) {
  return new Date(time).toISOString()
}

function evidenceFor(events, evidence) {
  const result = [...new Set([...(evidence ?? []), ...events.filter((event) => Number.isSafeInteger(event?.seq)).map((event) => `session:event:${event.seq}`)])]
  return result.length > 0 ? result : ['timing:unmeasured']
}

function unmeasured(stageId, evidence, waitingReason = 'unmeasured') {
  return validateContract('stageEvidence', {
    stageId,
    status: 'unmeasured',
    enteredAt: 'unmeasured',
    firstActionAt: 'unmeasured',
    exitedAt: 'unmeasured',
    durationMs: 0,
    activeMs: 0,
    waitingMs: 0,
    waitingReason,
    evidence: evidenceFor([], evidence),
    timingSource: 'unmeasured',
    waitingReasons: waitingReason === 'unmeasured' ? ['unmeasured'] : [waitingReason],
  })
}

export function projectStageTiming({ stageId, events = [], stageStartSeq = 0, stageEndSeq, status = 'completed', evidence = [] }) {
  const selected = events.filter((event) => Number.isSafeInteger(event?.seq) && event.seq >= stageStartSeq && (stageEndSeq === undefined || event.seq <= stageEndSeq))
  if (selected.length === 0 || selected.some((event) => eventTime(event) === undefined)) return unmeasured(stageId, evidence)
  const entered = selected[0]
  const exited = selected[selected.length - 1]
  const enteredTime = eventTime(entered)
  const exitedTime = eventTime(exited)
  if (enteredTime === undefined || exitedTime === undefined || exitedTime < enteredTime) return unmeasured(stageId, evidence, 'invalid-event-time')
  const firstAction = selected.find((event) => event.type !== 'turn/start') ?? entered
  const activeEvents = selected.filter((event) => event.type !== 'turn/start' && event.type !== 'turn/end')
  const waiting = new Map()
  const waitingReasons = new Set()
  for (const event of selected) {
    const time = eventTime(event)
    for (const [reason, pair] of Object.entries(WAITING_PAIR_TYPES)) {
      if (pair.start.has(event.type)) {
        waiting.set(reason, time)
        waitingReasons.add(reason)
      } else if (pair.end.has(event.type) && waiting.has(reason)) {
        waiting.set(`${reason}:duration`, Math.max(0, time - waiting.get(reason)))
        waiting.delete(reason)
      }
    }
  }
  for (const [reason, startedAt] of [...waiting.entries()]) {
    if (reason.includes(':duration')) continue
    waiting.set(`${reason}:duration`, Math.max(0, exitedTime - startedAt))
  }
  const waitingMs = [...waiting.entries()].filter(([key]) => key.endsWith(':duration')).reduce((total, [, value]) => total + value, 0)
  const durationMs = exitedTime - enteredTime
  const normalizedWaitingMs = Math.min(durationMs, waitingMs)
  const result = {
    stageId,
    status,
    enteredAt: iso(enteredTime),
    firstActionAt: iso(eventTime(firstAction)),
    exitedAt: iso(exitedTime),
    durationMs,
    activeMs: Math.max(0, durationMs - normalizedWaitingMs),
    waitingMs: normalizedWaitingMs,
    waitingReason: waitingReasons.size === 0 ? 'none' : [...waitingReasons].sort().join('+'),
    evidence: evidenceFor(activeEvents.length > 0 ? selected : [entered, exited], evidence),
    timingSource: 'host-session',
    waitingReasons: waitingReasons.size === 0 ? ['none'] : [...waitingReasons].sort(),
  }
  return validateContract('stageEvidence', result)
}

export function createPluginClockTiming({ stageId, enteredAt, firstActionAt, exitedAt, waitingIntervals = [], status = 'completed', evidence = [] }) {
  const entered = new Date(enteredAt).getTime()
  const firstAction = new Date(firstActionAt).getTime()
  const exited = new Date(exitedAt).getTime()
  if (![entered, firstAction, exited].every(Number.isFinite) || firstAction < entered || exited < firstAction) return unmeasured(stageId, evidence, 'invalid-plugin-clock')
  const reasons = [...new Set(waitingIntervals.map((interval) => interval.reason).filter(Boolean))].sort()
  const waitingMs = waitingIntervals.reduce((total, interval) => {
    const start = new Date(interval.startedAt).getTime()
    const end = new Date(interval.endedAt).getTime()
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? total + end - start : total
  }, 0)
  const durationMs = exited - entered
  const normalizedWaitingMs = Math.min(durationMs, waitingMs)
  return validateContract('stageEvidence', {
    stageId,
    status,
    enteredAt: iso(entered),
    firstActionAt: iso(firstAction),
    exitedAt: iso(exited),
    durationMs,
    activeMs: Math.max(0, durationMs - normalizedWaitingMs),
    waitingMs: normalizedWaitingMs,
    waitingReason: reasons.length === 0 ? 'none' : reasons.join('+'),
    evidence,
    timingSource: 'plugin-clock',
    waitingReasons: reasons.length === 0 ? ['none'] : reasons,
  })
}
