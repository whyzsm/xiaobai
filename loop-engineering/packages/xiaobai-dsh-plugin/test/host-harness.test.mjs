import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, hostAgentEvidence, runHostAgentTurn } from '../lib/index.js'

test('Host Agent harness runs the domain callback only from agent/pre-step', async () => {
  let preStep
  let disposed = false
  const agent = { session: { events: [] }, followup(message) { assert.equal(message.source.kind, 'user'); void preStep({ agent, signal: new AbortController().signal, turn: 1, step: 0 }, async () => ({ kind: 'enter', messages: [] })) }, whenIdle() { return Promise.resolve() } }
  const ctx = {
    get: (key) => key === 'agents' ? { create: async ({ sessionId, setup }) => { assert.equal(sessionId, 'session_test'); const agentCtx = { on: (event, listener) => { assert.equal(event, 'agent/pre-step'); preStep = listener; return () => {} } }; await setup(agentCtx); return { agent, dispose: async () => { disposed = true } } } } : undefined,
  }
  const result = await runHostAgentTurn({ ctx, sessionId: 'session_test', userMessage: 'run', createUserMessage: (content) => ({ role: 'user', content: [{ type: 'text', text: content }], source: { kind: 'user' } }), run: async ({ agent: currentAgent, signal, turn, step }) => ({ currentAgent, aborted: signal.aborted, turn, step }) })
  assert.equal(result.currentAgent, agent)
  assert.equal(result.aborted, false)
  assert.equal(result.turn, 1)
  assert.equal(result.step, 0)
  assert.equal(disposed, true)
})

test('Host Agent harness fails closed when the Host Agent service is absent', async () => {
  await assert.rejects(
    () => runHostAgentTurn({ ctx: { get: () => undefined }, sessionId: 'session_test', userMessage: 'run', createUserMessage: () => ({}), run: async () => {} }),
    (error) => error.code === ERROR_CODES.HOST_UNSUPPORTED,
  )
})

test('Host Agent harness can report Agent-owned context, status, and session evidence', async () => {
  let preStep
  const agent = { id: 'agent_harness_test', status: 'running', session: { events: [{ seq: 1, time: 10 }] }, followup() { void preStep({ agent, signal: new AbortController().signal, turn: 1, step: 0 }) }, whenIdle() { return new Promise((resolve) => setImmediate(resolve)) } }
  const ctx = {
    get: (key) => key === 'agents' ? { create: async ({ setup }) => {
      const agentCtx = { on: (_event, listener) => { preStep = listener; return () => {} } }
      agent.ctx = agentCtx
      await setup(agentCtx)
      return { agent, dispose: async () => {} }
    } } : undefined,
  }
  const result = await runHostAgentTurn({ ctx, sessionId: 'session_evidence', userMessage: 'run', createUserMessage: () => ({}), captureEvidence: true, run: async () => ({ ok: true }) })
  assert.deepEqual(result.result, { ok: true })
  assert.equal(result.agentEvidence.agentContextIsAgentOwned, true)
  assert.equal(result.agentEvidence.timedSessionEventCount, 1)
  assert.deepEqual(result.sessionEvents, [{ seq: 1, time: 10 }])
  assert.equal(hostAgentEvidence(agent, agent.ctx).status, 'running')
})

test('Host Agent harness preserves the primary failure when disposal also fails', async () => {
  const primary = new Error('turn failed')
  const cleanup = new Error('dispose failed')
  const agent = { followup() {}, whenIdle: async () => { throw primary } }
  const ctx = { get: (key) => key === 'agents' ? { create: async () => ({ agent, dispose: async () => { throw cleanup } }) } : undefined }
  await assert.rejects(() => runHostAgentTurn({ ctx, sessionId: 'session_failure', userMessage: 'run', createUserMessage: () => ({}), run: async () => ({}) }), (error) => error === primary && error.cleanupErrors?.[0] === cleanup)
})
